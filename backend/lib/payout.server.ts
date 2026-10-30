// Auto payout queue: withdrawals are sent in wallet batches and confirmed by seqno.
import { Address, beginCell, external, internal, SendMode, storeMessage } from "@ton/core";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { getDb, withWriteTransaction, asRow, asNumber, asText } from "./db.server.ts";
import { botApi } from "./tg.server.ts";

const TONCENTER = "https://toncenter.com/api/v2";
const RETRY_AFTER_MS = 90_000;
const LOCK_MS = 60_000;

const headers = (): Record<string, string> => {
  const key = process.env["TONCENTER_API_KEY"];
  return { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) };
};

export async function getTonUsd(): Promise<number> {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd");
    if (response.ok) {
      const payload = (await response.json()) as { "the-open-network"?: { usd?: number } };
      const price = payload["the-open-network"]?.usd;
      if (price && price > 0) return price;
    }
  } catch {
    // Try the fallback provider below.
  }

  const response = await fetch("https://tonapi.io/v2/rates?tokens=ton&currencies=usd");
  if (!response.ok) throw new Error("Price unavailable, try again");
  const payload = (await response.json()) as { rates?: { TON?: { prices?: { USD?: number } } } };
  const price = payload.rates?.TON?.prices?.USD;
  if (!price || price <= 0) throw new Error("Price unavailable, try again");
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
    const response = await fetch(TONCENTER + path, { ...init, headers: headers() });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: string };
    if (response.ok && payload.ok) return payload.result as T;
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    if (attempt === 2) throw new Error(payload.error ?? "toncenter " + response.status);
  }
  throw new Error("toncenter failed");
}

async function getSeqno(address: string): Promise<number> {
  const result = await tc<{ exit_code: number; stack: [string, string][] }>("/runGetMethod", {
    method: "POST",
    body: JSON.stringify({ address, method: "seqno", stack: [] }),
  });
  if (result.exit_code !== 0 || !result.stack?.[0]) return 0;
  return parseInt(result.stack[0][1], 16);
}

async function getBalance(address: string): Promise<bigint> {
  return BigInt(await tc<string>("/getAddressBalance?address=" + encodeURIComponent(address)));
}

async function acquireLock(): Promise<boolean> {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + LOCK_MS).toISOString();
  await getDb().execute({
    sql: "INSERT INTO locks(id, until) VALUES ('payout', ?) ON CONFLICT(id) DO NOTHING",
    args: [new Date(0).toISOString()],
  });
  const result = await getDb().execute({
    sql: "UPDATE locks SET until = ? WHERE id = 'payout' AND until < ?",
    args: [until, now],
  });
  return result.rowsAffected > 0;
}

async function releaseLock() {
  await getDb().execute({
    sql: "UPDATE locks SET until = ? WHERE id = 'payout'",
    args: [new Date(0).toISOString()],
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
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function postProofs(ids: string[]) {
  const chat = process.env["PAYMENT_PROOF_CHAT_ID"];
  if (!chat || !ids.length) return;

  const placeholders = ids.map(() => "?").join(", ");
  const result = await getDb().execute({
    sql: "SELECT * FROM withdrawals WHERE id IN (" + placeholders + ") AND proof_posted = 0",
    args: ids,
  });

  for (const value of result.rows) {
    const withdrawal = asRow(value);
    const playerResult = await getDb().execute({
      sql: "SELECT first_name, username FROM players WHERE tg_id = ?",
      args: [asNumber(withRow(withdrawal, "tg_id"))],
    });
    const player = playerResult.rows[0] ? asRow(playerResult.rows[0]) : {};
    const nano = BigInt(asText(withdrawal["nano"]));
    const ton = (Number(nano) / 1e9).toFixed(9).replace(/\.?0+$/, "");
    const address = asText(withdrawal["address"]);
    const name = escapeHtml(asText(player["first_name"] || "Miner"));
    const username = player["username"] ? " (@" + escapeHtml(asText(player["username"])) + ")" : "";
    const telegramId = asText(withdrawal["tg_id"]);
    const withdrawalId = escapeHtml(asText(withdrawal["id"]));
    const sentAtRaw = asText(withdrawal["sent_at"] || withdrawal["created_at"]);
    const sentAt = Number.isNaN(Date.parse(sentAtRaw))
      ? sentAtRaw
      : new Date(sentAtRaw).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
    const message =
      "✅ <b>Withdrawal sent</b>\n\n" +
      "👤 User: <b>" + name + "</b>" + username + "\n" +
      "🆔 Telegram ID: <code>" + telegramId + "</code>\n" +
      "💵 USD amount: <b>$" + (asNumber(withdrawal["amount_milli"]) / 1000).toFixed(3) + "</b>\n" +
      "💎 TON amount: <b>" + ton + " TON</b>\n" +
      "👛 Wallet: <code>" + escapeHtml(address) + "</code>\n" +
      "🧾 Withdrawal ID: <code>" + withdrawalId + "</code>\n" +
      "🕒 Sent at: <code>" + escapeHtml(sentAt) + "</code>\n" +
      "🔗 <a href=\"https://tonviewer.com/" + encodeURIComponent(address) + "\">View wallet on Tonviewer</a>\n\n" +
      "⛏ Gram Miner — auto withdrawal";

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
        ? `https://t.me/${username}/${posted.message_id}`
        : chatId.startsWith("-100")
          ? `https://t.me/c/${chatId.slice(4)}/${posted.message_id}`
          : null;
      await getDb().execute({
        sql: "UPDATE withdrawals SET proof_posted = 1, proof_message_url = ? WHERE id = ?",
        args: [proofMessageUrl, asText(withdrawal["id"])],
      });
    } catch (error) {
      console.error("proof post failed", error);
    }
  }
}

function withRow(row: Record<string, unknown>, key: string) {
  return row[key];
}

/** One payout pass: confirm any in-flight batches, then send at most one new batch. */
export async function runPayouts(): Promise<{ sent: number; note?: string }> {
  if (!process.env["TON_WALLET_MNEMONIC"]) return { sent: 0, note: "not configured" };
  if (!(await acquireLock())) return { sent: 0, note: "locked" };

  try {
    const { contract, secretKey, max } = await wallet();
    const address = contract.address.toString({ bounceable: false });
    const openResult = await getDb().execute("SELECT * FROM payout_batches WHERE status = 'sending'");
    let sent = 0;

    if (openResult.rows.length) {
      const seqno = await getSeqno(address);
      for (const value of openResult.rows) {
        const batch = asRow(value);
        const ids = parseIds(batch["ids"]);
        if (seqno > asNumber(batch["seqno"])) {
          await withWriteTransaction(async (tx) => {
            if (ids.length) {
              const slots = ids.map(() => "?").join(", ");
              await tx.execute({
                sql: "UPDATE withdrawals SET status = 'sent', sent_at = ? WHERE id IN (" + slots + ") AND status = 'sending'",
                args: [new Date().toISOString(), ...ids],
              });
            }
            await tx.execute({
              sql: "UPDATE payout_batches SET status = 'done' WHERE id = ?",
              args: [asText(batch["id"])],
            });
          });
          await postProofs(ids);
          sent += ids.length;
        } else if (Date.now() - new Date(asText(batch["sent_at"])).getTime() > RETRY_AFTER_MS) {
          await withWriteTransaction(async (tx) => {
            if (ids.length) {
              const slots = ids.map(() => "?").join(", ");
              await tx.execute({
                sql: "UPDATE withdrawals SET status = 'pending', batch_id = NULL WHERE id IN (" + slots + ") AND status = 'sending'",
                args: ids,
              });
            }
            await tx.execute({
              sql: "UPDATE payout_batches SET status = 'done' WHERE id = ?",
              args: [asText(batch["id"])],
            });
          });
        } else {
          return { sent, note: "waiting for previous batch" };
        }
      }
    }

    const pendingResult = await getDb().execute({
      sql: "SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY created_at LIMIT ?",
      args: [max],
    });
    if (!pendingResult.rows.length) return { sent };

    const balance = await getBalance(address);
    const reserve = 50_000_000n;
    const selected: Record<string, unknown>[] = [];
    let total = 0n;
    for (const value of pendingResult.rows) {
      const withdrawal = asRow(value);
      const amount = BigInt(asText(withdrawal["nano"]));
      if (balance < total + amount + reserve + 10_000_000n * BigInt(selected.length + 1)) break;
      selected.push(withdrawal);
      total += amount;
    }
    if (!selected.length) return { sent, note: "payout wallet low on funds" };

    const seqno = await getSeqno(address);
    const batchId = crypto.randomUUID();
    const ids = selected.map((row) => asText(row["id"]));
    await withWriteTransaction(async (tx) => {
      await tx.execute({
        sql: "INSERT INTO payout_batches(id, seqno, ids, sent_at, status) VALUES (?, ?, ?, ?, 'sending')",
        args: [batchId, seqno, JSON.stringify(ids), new Date().toISOString()],
      });
      const slots = ids.map(() => "?").join(", ");
      await tx.execute({
        sql: "UPDATE withdrawals SET status = 'sending', batch_id = ? WHERE id IN (" + slots + ") AND status = 'pending'",
        args: [batchId, ...ids],
      });
    });

    const body = await (contract as unknown as {
      createTransfer: (args: unknown) => Promise<import("@ton/core").Cell> | import("@ton/core").Cell;
    }).createTransfer({
      seqno,
      secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: selected.map((row) =>
        internal({
          to: Address.parse(asText(row["address"])),
          value: BigInt(asText(row["nano"])),
          bounce: false,
          body: beginCell().storeUint(0, 32).storeStringTail("Gram Miner withdraw").endCell(),
        }),
      ),
    } as never);

    const externalMessage = external({
      to: contract.address,
      init: seqno === 0 ? contract.init : undefined,
      body,
    });
    const boc = beginCell().store(storeMessage(externalMessage)).endCell().toBoc().toString("base64");
    await tc("/sendBoc", { method: "POST", body: JSON.stringify({ boc }) });
    return { sent, note: "batch sent, confirming" };
  } catch (error) {
    console.error("payout run failed", error);
    return { sent: 0, note: error instanceof Error ? error.message : "error" };
  } finally {
    await releaseLock().catch((error) => console.error("payout lock release failed", error));
  }
}
