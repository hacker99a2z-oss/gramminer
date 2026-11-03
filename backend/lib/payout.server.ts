import { Address, beginCell, external, internal, SendMode, storeMessage } from "@ton/core";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { randomUUID } from "node:crypto";
import { getDb, withWriteTransaction, asRow, asNumber, asText } from "./db.server.ts";
import { botApi } from "./tg.server.ts";
import {
  matchPayoutMessages,
  normalizeTonHash,
  transactionMatchesExternalHash,
  type TonTransaction,
} from "./payout-utils.ts";

const TONCENTER = "https://toncenter.com/api/v2";
const LOCK_MS = 120_000;
const HEARTBEAT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const WALLET_MESSAGE_TTL_SECONDS = 5 * 60;
const WALLET_MESSAGE_GRACE_MS = 7 * 60_000;
const MAX_TRANSACTIONS = 100;

const headers = (): Record<string, string> => {
  const key = process.env["TONCENTER_API_KEY"];
  return { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) };
};

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export async function getTonUsd(): Promise<number> {
  try {
    const response = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd");
    if (response.ok) {
      const payload = await response.json() as { "the-open-network"?: { usd?: number } };
      const price = payload["the-open-network"]?.usd;
      if (price && Number.isFinite(price) && price > 0) return price;
    }
  } catch {
    // Try the fallback provider below.
  }

  const response = await fetchWithTimeout("https://tonapi.io/v2/rates?tokens=ton&currencies=usd");
  if (!response.ok) throw new Error("Price unavailable, try again");
  const payload = await response.json() as { rates?: { TON?: { prices?: { USD?: number } } } };
  const price = payload.rates?.TON?.prices?.USD;
  if (!price || !Number.isFinite(price) || price <= 0) throw new Error("Price unavailable, try again");
  return price;
}

async function wallet() {
  const words = process.env["TON_WALLET_MNEMONIC"];
  if (!words) throw new Error("TON_WALLET_MNEMONIC missing");
  const key = await mnemonicToPrivateKey(words.trim().replace(/^"|"$/g, "").split(/\s+/));
  const v4 = (process.env["TON_WALLET_VERSION"] ?? "v5r1").toLowerCase() === "v4";
  const contract = v4
    ? WalletContractV4.create({ workchain: 0, publicKey: key.publicKey })
    : WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey });
  return { contract, secretKey: key.secretKey, max: v4 ? 4 : 100 };
}

async function tc<T>(path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchWithTimeout(TONCENTER + path, { ...init, headers: headers() });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; error?: string };
    if (response.ok && payload.ok) return payload.result as T;
    if (response.status !== 429 && response.status < 500) {
      throw new Error(payload.error ?? "TON Center request failed (" + response.status + ")");
    }
    if (attempt === 2) throw new Error(payload.error ?? "TON Center request failed (" + response.status + ")");
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  throw new Error("TON Center request failed");
}

async function getSeqno(address: string): Promise<number> {
  const result = await tc<{ exit_code: number; stack: [string, string][] }>("/runGetMethod", {
    method: "POST",
    body: JSON.stringify({ address, method: "seqno", stack: [] }),
  });
  if (result.exit_code !== 0 || !result.stack?.[0]) throw new Error("Could not read TON wallet seqno");
  const seqno = Number.parseInt(result.stack[0][1], 16);
  if (!Number.isSafeInteger(seqno) || seqno < 0) throw new Error("TON wallet returned an invalid seqno");
  return seqno;
}

async function getBalance(address: string): Promise<bigint> {
  return BigInt(await tc<string>("/getAddressBalance?address=" + encodeURIComponent(address)));
}

async function getTransactions(address: string): Promise<TonTransaction[]> {
  return tc<TonTransaction[]>("/getTransactions", {
    method: "POST",
    body: JSON.stringify({ address, limit: MAX_TRANSACTIONS }),
  });
}

async function acquireLock(ownerToken: string): Promise<boolean> {
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO locks(id, until, owner_token) VALUES ('payout', ?, NULL) ON CONFLICT(id) DO NOTHING",
    args: [new Date(0).toISOString()],
  });
  const result = await db.execute({
    sql: "UPDATE locks SET until = ?, owner_token = ? WHERE id = 'payout' AND until < ?",
    args: [new Date(Date.now() + LOCK_MS).toISOString(), ownerToken, new Date().toISOString()],
  });
  return result.rowsAffected === 1;
}

async function renewLock(ownerToken: string): Promise<boolean> {
  const result = await getDb().execute({
    sql: "UPDATE locks SET until = ? WHERE id = 'payout' AND owner_token = ? AND until >= ?",
    args: [new Date(Date.now() + LOCK_MS).toISOString(), ownerToken, new Date().toISOString()],
  });
  return result.rowsAffected === 1;
}

async function releaseLock(ownerToken: string): Promise<void> {
  await getDb().execute({
    sql: "UPDATE locks SET until = ?, owner_token = NULL WHERE id = 'payout' AND owner_token = ?",
    args: [new Date(0).toISOString(), ownerToken],
  });
}

function parseIds(value: unknown): string[] {
  try {
    const parsed = JSON.parse(asText(value)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function postProofs(ownerToken: string): Promise<number> {
  const chat = process.env["PAYMENT_PROOF_CHAT_ID"];
  if (!chat) return 0;
  const now = new Date().toISOString();
  const result = await getDb().execute({
    sql: "SELECT * FROM withdrawals WHERE status = 'sent' AND proof_posted = 0 AND (proof_next_attempt_at IS NULL OR proof_next_attempt_at <= ?) ORDER BY sent_at LIMIT 25",
    args: [now],
  });
  let postedCount = 0;

  for (const value of result.rows) {
    if (!(await renewLock(ownerToken))) break;
    const withdrawal = asRow(value);
    const id = asText(withdrawal["id"]);
    const nano = BigInt(asText(withdrawal["nano"]));
    const ton = (Number(nano) / 1e9).toFixed(9).replace(/\.?0+$/, "");
    const txHash = asText(withdrawal["tx_hash"]);
    const message = [
      "✅ <b>Withdrawal sent</b>",
      "",
      "💵 USD amount: <b>$" + (asNumber(withdrawal["amount_milli"]) / 1000).toFixed(3) + "</b>",
      "💎 TON amount: <b>" + ton + " TON</b>",
      "🧾 Withdrawal: <code>" + escapeHtml(id) + "</code>",
      "🔗 <a href=\"https://tonviewer.com/transaction/" + encodeURIComponent(txHash) + "\">View transaction</a>",
      "",
      "⛏ Gram Miner — auto withdrawal",
    ].join("\n");

    try {
      const posted = await botApi<{
        message_id: number;
        chat: { id: number; username?: string };
      }>("sendMessage", {
        chat_id: chat,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      const username = posted.chat.username ?? (chat.startsWith("@") ? chat.slice(1) : "");
      const chatId = String(posted.chat.id);
      const proofMessageUrl = username
        ? "https://t.me/" + username + "/" + posted.message_id
        : chatId.startsWith("-100")
          ? "https://t.me/c/" + chatId.slice(4) + "/" + posted.message_id
          : null;
      await getDb().execute({
        sql: "UPDATE withdrawals SET proof_posted = 1, proof_message_url = ?, proof_next_attempt_at = NULL WHERE id = ? AND status = 'sent' AND proof_posted = 0",
        args: [proofMessageUrl, id],
      });
      postedCount++;
    } catch (error) {
      const attempts = asNumber(withdrawal["proof_attempts"]) + 1;
      const delay = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(9, attempts - 1));
      await getDb().execute({
        sql: "UPDATE withdrawals SET proof_attempts = ?, proof_next_attempt_at = ? WHERE id = ? AND proof_posted = 0",
        args: [attempts, new Date(Date.now() + delay).toISOString(), id],
      });
      console.error("[payout] proof publication failed; scheduled for retry", { withdrawalId: id, attempts, error });
    }
  }
  return postedCount;
}

/** Old in-flight rows have no persisted signed message identity. Never re-send them automatically. */
async function markLegacyBatchesForReview(): Promise<number> {
  const legacy = await getDb().execute(
    "SELECT id, ids FROM payout_batches WHERE status IN ('sending', 'broadcasting') AND (tx_hash IS NULL OR boc IS NULL)",
  );
  let moved = 0;
  for (const value of legacy.rows) {
    const batch = asRow(value);
    const ids = parseIds(batch["ids"]);
    await withWriteTransaction(async (tx) => {
      if (ids.length) {
        const slots = ids.map(() => "?").join(", ");
        const result = await tx.execute({
          sql: "UPDATE withdrawals SET status = 'manual_review' WHERE id IN (" + slots + ") AND status = 'sending'",
          args: ids,
        });
        moved += result.rowsAffected;
      }
      await tx.execute({
        sql: "UPDATE payout_batches SET status = 'manual_review' WHERE id = ? AND status IN ('sending', 'broadcasting')",
        args: [asText(batch["id"])],
      });
    });
  }

  // The earlier seqno-only implementation may have marked rows as sent without
  // persisting a transaction hash. Those cannot be considered verified here.
  const historical = await getDb().execute(
    "UPDATE withdrawals SET status = 'manual_review' WHERE status = 'sent' AND tx_hash IS NULL",
  );
  moved += historical.rowsAffected;
  return moved;
}

async function reconcileOpenBatches(
  ownerToken: string,
  currentSeqno: number,
  transactions: TonTransaction[],
): Promise<{ confirmed: number; review: number; expired: number; note?: string }> {
  const open = await getDb().execute("SELECT * FROM payout_batches WHERE status IN ('sending', 'broadcasting')");
  let confirmed = 0;
  let review = 0;
  let expired = 0;

  for (const value of open.rows) {
    if (!(await renewLock(ownerToken))) return { confirmed, review, expired, note: "payout lock lost" };
    const batch = asRow(value);
    const batchId = asText(batch["id"]);
    const ids = parseIds(batch["ids"]);
    const externalHash = asText(batch["tx_hash"]);
    const sentAt = asText(batch["sent_at"]);
    const transaction = transactions.find((item) => transactionMatchesExternalHash(item, externalHash));

    if (transaction) {
      const expectedResult = await getDb().execute({
        sql: "SELECT id, address, nano, body_hash FROM withdrawals WHERE id IN (" + ids.map(() => "?").join(", ") + ") AND status = 'sending'",
        args: ids,
      });
      const expected = expectedResult.rows.map((row) => {
        const item = asRow(row);
        return {
          id: asText(item["id"]),
          address: asText(item["address"]),
          nano: asText(item["nano"]),
          bodyHash: asText(item["body_hash"]),
        };
      });
      const output = expected.length === ids.length
        ? matchPayoutMessages(expected, transaction.out_msgs ?? [])
        : { matched: [] as string[], unmatched: ids };
      const transactionHash = normalizeTonHash(transaction.transaction_id?.hash)
        ?? asText(transaction.transaction_id?.hash);
      const confirmedAt = new Date(Number(transaction.utime ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

      await withWriteTransaction(async (tx) => {
        for (const withdrawalId of output.matched) {
          await tx.execute({
            sql: "UPDATE withdrawals SET status = 'sent', sent_at = ?, tx_hash = ? WHERE id = ? AND status = 'sending'",
            args: [confirmedAt, transactionHash, withdrawalId],
          });
        }
        if (output.unmatched.length) {
          const slots = output.unmatched.map(() => "?").join(", ");
          await tx.execute({
            sql: "UPDATE withdrawals SET status = 'manual_review' WHERE id IN (" + slots + ") AND status = 'sending'",
            args: output.unmatched,
          });
        }
        await tx.execute({
          sql: "UPDATE payout_batches SET status = ?, confirmed_at = ? WHERE id = ?",
          args: [output.unmatched.length ? "manual_review" : "done", confirmedAt, batchId],
        });
      });
      confirmed += output.matched.length;
      review += output.unmatched.length;
      continue;
    }

    const age = Date.now() - Date.parse(sentAt);
    if (!Number.isFinite(age) || age < 0) {
      return { confirmed, review, expired, note: "invalid payout batch timestamp" };
    }

    if (currentSeqno > asNumber(batch["seqno"])) {
      // TON Center can briefly lag behind the wallet seqno. Do not mark a
      // broadcast payout for manual review until its indexing grace period ends.
      if (age <= WALLET_MESSAGE_GRACE_MS) {
        return { confirmed, review, expired, note: "waiting for wallet transaction indexing" };
      }
      await withWriteTransaction(async (tx) => {
        if (ids.length) {
          const slots = ids.map(() => "?").join(", ");
          await tx.execute({
            sql: "UPDATE withdrawals SET status = 'manual_review' WHERE id IN (" + slots + ") AND status = 'sending'",
            args: ids,
          });
        }
        await tx.execute({
          sql: "UPDATE payout_batches SET status = 'manual_review', confirmed_at = ? WHERE id = ?",
          args: [new Date().toISOString(), batchId],
        });
      });
      review += ids.length;
      continue;
    }

    if (age > WALLET_MESSAGE_GRACE_MS && currentSeqno === asNumber(batch["seqno"])) {
      await withWriteTransaction(async (tx) => {
        if (ids.length) {
          const slots = ids.map(() => "?").join(", ");
          await tx.execute({
            sql: "UPDATE withdrawals SET status = 'pending', batch_id = NULL, body_hash = NULL WHERE id IN (" + slots + ") AND status = 'sending'",
            args: ids,
          });
        }
        await tx.execute({
          sql: "UPDATE payout_batches SET status = 'expired', boc = NULL WHERE id = ? AND status IN ('sending', 'broadcasting')",
          args: [batchId],
        });
      });
      expired += ids.length;
      continue;
    }

    const boc = asText(batch["boc"]);
    if (!boc) return { confirmed, review, expired, note: "payout batch has no signed message" };
    if (!(await renewLock(ownerToken))) return { confirmed, review, expired, note: "payout lock lost" };
    // Re-broadcast the exact same signed BOC; never create a second live message.
    await tc("/sendBoc", { method: "POST", body: JSON.stringify({ boc }) });
    await getDb().execute({
      sql: "UPDATE payout_batches SET last_broadcast_at = ? WHERE id = ? AND status IN ('sending', 'broadcasting')",
      args: [new Date().toISOString(), batchId],
    });
  }

  return { confirmed, review, expired };
}

async function heartbeatLock(ownerToken: string, onLost: () => void): Promise<() => void> {
  let stopped = false;
  const interval = setInterval(() => {
    void renewLock(ownerToken).then((ok) => {
      if (!ok && !stopped) onLost();
    }).catch(() => {
      if (!stopped) onLost();
    });
  }, HEARTBEAT_MS);
  interval.unref?.();
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/** Run only from the authenticated payout cron endpoint; never from player requests. */
export async function runPayouts(): Promise<{
  confirmed: number;
  manualReview: number;
  expired: number;
  proofPosts: number;
  note?: string;
}> {
  const ownerToken = randomUUID();
  if (!(await acquireLock(ownerToken))) {
    return { confirmed: 0, manualReview: 0, expired: 0, proofPosts: 0, note: "payout worker locked" };
  }

  let leaseLost = false;
  const stopHeartbeat = await heartbeatLock(ownerToken, () => { leaseLost = true; });
  const assertLease = () => {
    if (leaseLost) throw new Error("Payout worker lost its database lease");
  };

  try {
    const manualReviewAtStart = await markLegacyBatchesForReview();
    assertLease();
    const proofPosts = await postProofs(ownerToken);
    if (!process.env["TON_WALLET_MNEMONIC"]) {
      return { confirmed: 0, manualReview: manualReviewAtStart, expired: 0, proofPosts, note: "payout wallet not configured" };
    }

    const { contract, secretKey, max } = await wallet();
    const walletAddress = contract.address.toString({ bounceable: false });
    assertLease();

    const transactions = await getTransactions(walletAddress);
    assertLease();
    const currentSeqno = await getSeqno(walletAddress);
    assertLease();
    const reconciled = await reconcileOpenBatches(ownerToken, currentSeqno, transactions);
    if (reconciled.note) {
      return {
        confirmed: reconciled.confirmed,
        manualReview: manualReviewAtStart + reconciled.review,
        expired: reconciled.expired,
        proofPosts: proofPosts + await postProofs(ownerToken),
        note: reconciled.note,
      };
    }

    const active = await getDb().execute("SELECT COUNT(*) AS count FROM payout_batches WHERE status IN ('sending', 'broadcasting')");
    if (asNumber(asRow(active.rows[0])["count"]) > 0) {
      return {
        confirmed: reconciled.confirmed,
        manualReview: manualReviewAtStart + reconciled.review,
        expired: reconciled.expired,
        proofPosts: proofPosts + await postProofs(ownerToken),
        note: "waiting for payout batch reconciliation",
      };
    }

    const pendingResult = await getDb().execute({
      sql: "SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY created_at LIMIT ?",
      args: [max],
    });
    if (!pendingResult.rows.length) {
      return {
        confirmed: reconciled.confirmed,
        manualReview: manualReviewAtStart + reconciled.review,
        expired: reconciled.expired,
        proofPosts: proofPosts + await postProofs(ownerToken),
      };
    }

    const balance = await getBalance(walletAddress);
    assertLease();
    const reserve = 50_000_000n;
    const selected: Record<string, unknown>[] = [];
    let total = 0n;
    for (const value of pendingResult.rows) {
      const withdrawal = asRow(value);
      const amount = BigInt(asText(withdrawal["nano"]));
      const feeReserve = 10_000_000n * BigInt(selected.length + 1);
      if (balance < total + amount + reserve + feeReserve) break;
      selected.push(withdrawal);
      total += amount;
    }
    if (!selected.length) {
      return {
        confirmed: reconciled.confirmed,
        manualReview: manualReviewAtStart + reconciled.review,
        expired: reconciled.expired,
        proofPosts: proofPosts + await postProofs(ownerToken),
        note: "payout wallet low on funds",
      };
    }

    assertLease();
    const seqno = await getSeqno(walletAddress);
    assertLease();
    const batchId = randomUUID();
    const withdrawalMessages = selected.map((row) => {
      const withdrawalId = asText(row["id"]);
      const comment = "GM:" + withdrawalId;
      const messageBody = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
      return {
        row,
        messageBody,
        bodyHash: messageBody.hash().toString("hex"),
        message: internal({
          to: Address.parse(asText(row["address"])),
          value: BigInt(asText(row["nano"])),
          bounce: false,
          body: messageBody,
        }),
      };
    });

    const timeout = Math.floor(Date.now() / 1000) + WALLET_MESSAGE_TTL_SECONDS;
    const walletContract = contract as unknown as {
      createTransfer: (args: unknown) => Promise<import("@ton/core").Cell> | import("@ton/core").Cell;
    };
    const signedBody = await walletContract.createTransfer({
      seqno,
      secretKey,
      timeout,
      // Wallet V5 requires IGNORE_ERRORS for external signed requests.
      // A withdrawal is still marked sent only after its exact out-message is verified.
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: withdrawalMessages.map((item) => item.message),
    });
    const externalMessage = external({
      to: contract.address,
      init: seqno === 0 ? contract.init : undefined,
      body: signedBody,
    });
    const externalCell = beginCell().store(storeMessage(externalMessage)).endCell();
    const externalHash = externalCell.hash().toString("hex");
    const boc = externalCell.toBoc().toString("base64");
    const createdAt = new Date().toISOString();

    await withWriteTransaction(async (tx) => {
      await tx.execute({
        sql: "INSERT INTO payout_batches(id, seqno, ids, sent_at, status, wallet_address, boc, tx_hash, last_broadcast_at) VALUES (?, ?, ?, ?, 'sending', ?, ?, ?, ?)",
        args: [batchId, seqno, JSON.stringify(selected.map((row) => asText(row["id"]))), createdAt, walletAddress, boc, externalHash, createdAt],
      });
      for (const item of withdrawalMessages) {
        const update = await tx.execute({
          sql: "UPDATE withdrawals SET status = 'sending', batch_id = ?, body_hash = ? WHERE id = ? AND status = 'pending'",
          args: [batchId, item.bodyHash, asText(item.row["id"])],
        });
        if (update.rowsAffected !== 1) throw new Error("Withdrawal queue changed while preparing payout");
      }
    });

    assertLease();
    await tc("/sendBoc", { method: "POST", body: JSON.stringify({ boc }) });
    await getDb().execute({
      sql: "UPDATE payout_batches SET last_broadcast_at = ? WHERE id = ? AND tx_hash = ?",
      args: [new Date().toISOString(), batchId, externalHash],
    });

    return {
      confirmed: reconciled.confirmed,
      manualReview: manualReviewAtStart + reconciled.review,
      expired: reconciled.expired,
      proofPosts,
      note: "signed payout broadcast; blockchain confirmation pending",
    };
  } finally {
    stopHeartbeat();
    await releaseLock(ownerToken).catch((error) => console.error("[payout] owner-checked lock release failed", error));
  }
}
