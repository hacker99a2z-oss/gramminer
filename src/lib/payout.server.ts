// Auto payout queue (same design as the original app): withdrawals are saved as "pending",
// one worker at a time sends many payouts in ONE wallet transaction, confirmed by wallet seqno.
// When a batch is confirmed, each payout is posted to the payment-proof Telegram channel.
import { Address, beginCell, external, internal, SendMode, storeMessage } from "@ton/core";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { botApi } from "./tg.server";

const TONCENTER = "https://toncenter.com/api/v2";
const RETRY_AFTER_MS = 90_000;
const LOCK_MS = 60_000;

const headers = (): Record<string, string> => {
  const key = process.env["TONCENTER_API_KEY"];
  return { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) };
};

export async function getTonUsd(): Promise<number> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd");
    if (r.ok) {
      const j = (await r.json()) as { "the-open-network"?: { usd?: number } };
      const p = j["the-open-network"]?.usd;
      if (p && p > 0) return p;
    }
  } catch { /* fall through */ }
  const r2 = await fetch("https://tonapi.io/v2/rates?tokens=ton&currencies=usd");
  const j2 = (await r2.json()) as { rates?: { TON?: { prices?: { USD?: number } } } };
  const p2 = j2.rates?.TON?.prices?.USD;
  if (!p2) throw new Error("Price unavailable, try again");
  return p2;
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
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${TONCENTER}${path}`, { ...init, headers: headers() });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: string };
    if (r.ok && j.ok) return j.result as T;
    await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
    if (i === 2) throw new Error(j.error ?? `toncenter ${r.status}`);
  }
  throw new Error("toncenter failed");
}

async function getSeqno(address: string): Promise<number> {
  const res = await tc<{ exit_code: number; stack: [string, string][] }>("/runGetMethod", {
    method: "POST",
    body: JSON.stringify({ address, method: "seqno", stack: [] }),
  });
  if (res.exit_code !== 0 || !res.stack?.[0]) return 0;
  return parseInt(res.stack[0][1], 16);
}

async function getBalance(address: string): Promise<bigint> {
  return BigInt(await tc<string>(`/getAddressBalance?address=${encodeURIComponent(address)}`));
}

async function acquireLock(): Promise<boolean> {
  const until = new Date(Date.now() + LOCK_MS).toISOString();
  await supabaseAdmin.from("locks").upsert({ id: "payout", until: new Date(0).toISOString() }, { onConflict: "id", ignoreDuplicates: true });
  const { data } = await supabaseAdmin.from("locks").update({ until }).eq("id", "payout").lt("until", new Date().toISOString()).select("id");
  return !!data?.length;
}
const releaseLock = () => supabaseAdmin.from("locks").update({ until: new Date(0).toISOString() }).eq("id", "payout");

async function postProofs(ids: string[]) {
  const chat = process.env["PAYMENT_PROOF_CHAT_ID"];
  if (!chat || !ids.length) return;
  const { data: rows } = await supabaseAdmin.from("withdrawals").select("*").in("id", ids).eq("proof_posted", false);
  for (const w of rows ?? []) {
    const { data: p } = await supabaseAdmin.from("players").select("first_name, username").eq("tg_id", w.tg_id).maybeSingle();
    const ton = (Number(BigInt(w.nano)) / 1e9).toFixed(4);
    const addr = `${w.address.slice(0, 6)}…${w.address.slice(-6)}`;
    const name = (p?.first_name ?? "Miner").replace(/[<>&]/g, "");
    const text =
      `✅ <b>New Withdrawal Paid</b>\n\n` +
      `👤 User: <b>${name}</b>${p?.username ? ` (@${p.username})` : ""}\n` +
      `🆔 ID: <code>${w.tg_id}</code>\n` +
      `💵 Amount: <b>$${(w.amount_milli / 1000).toFixed(3)}</b> (${ton} TON)\n` +
      `👛 Wallet: <code>${addr}</code>\n` +
      `🔗 <a href="https://tonviewer.com/${w.address}">View on Tonviewer</a>\n\n` +
      `⛏ Gram Miner — auto withdrawal`;
    try {
      await botApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });
      await supabaseAdmin.from("withdrawals").update({ proof_posted: true }).eq("id", w.id);
    } catch (e) {
      console.error("proof post failed", e);
    }
  }
}

/** One payout pass: confirm in-flight batches, then send one new batch (no long waits). */
export async function runPayouts(): Promise<{ sent: number; note?: string }> {
  if (!process.env["TON_WALLET_MNEMONIC"]) return { sent: 0, note: "not configured" };
  if (!(await acquireLock())) return { sent: 0, note: "locked" };
  try {
    const { contract, secretKey, max } = await wallet();
    const address = contract.address.toString({ bounceable: false });
    const { data: open } = await supabaseAdmin.from("payout_batches").select("*").eq("status", "sending");
    let sent = 0;
    if (open?.length) {
      const seqno = await getSeqno(address);
      for (const b of open) {
        if (seqno > b.seqno) {
          await supabaseAdmin.from("withdrawals").update({ status: "sent", sent_at: new Date().toISOString() }).in("id", b.ids).eq("status", "sending");
          await supabaseAdmin.from("payout_batches").update({ status: "done" }).eq("id", b.id);
          await postProofs(b.ids);
          sent += b.ids.length;
        } else if (Date.now() - new Date(b.sent_at).getTime() > RETRY_AFTER_MS) {
          await supabaseAdmin.from("withdrawals").update({ status: "pending", batch_id: null }).in("id", b.ids).eq("status", "sending");
          await supabaseAdmin.from("payout_batches").update({ status: "done" }).eq("id", b.id);
        } else {
          return { sent, note: "waiting for previous batch" };
        }
      }
    }

    const { data: list } = await supabaseAdmin.from("withdrawals").select("*").eq("status", "pending").order("created_at").limit(max);
    if (!list?.length) return { sent };
    const balance = await getBalance(address);
    const reserve = 50_000_000n;
    const take: typeof list = [];
    let total = 0n;
    for (const w of list) {
      const n = BigInt(w.nano);
      if (balance < total + n + reserve + 10_000_000n * BigInt(take.length + 1)) break;
      take.push(w);
      total += n;
    }
    if (!take.length) return { sent, note: "payout wallet low on funds" };

    const seqno = await getSeqno(address);
    const batchId = crypto.randomUUID();
    const ids = take.map((w) => w.id);
    await supabaseAdmin.from("payout_batches").insert({ id: batchId, seqno, ids });
    await supabaseAdmin.from("withdrawals").update({ status: "sending", batch_id: batchId }).in("id", ids).eq("status", "pending");

    const body = await (contract as unknown as { createTransfer: (a: unknown) => Promise<import("@ton/core").Cell> | import("@ton/core").Cell }).createTransfer({
      seqno,
      secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: take.map((w) =>
        internal({
          to: Address.parse(w.address),
          value: BigInt(w.nano),
          bounce: false,
          body: beginCell().storeUint(0, 32).storeStringTail("Gram Miner withdraw").endCell(),
        }),
      ),
    } as never);
    const ext = external({ to: contract.address, init: seqno === 0 ? contract.init : undefined, body });
    const boc = beginCell().store(storeMessage(ext)).endCell().toBoc().toString("base64");
    await tc("/sendBoc", { method: "POST", body: JSON.stringify({ boc }) });
    return { sent, note: "batch sent, confirming" };
  } catch (e) {
    console.error("payout run failed", e);
    return { sent: 0, note: e instanceof Error ? e.message : "error" };
  } finally {
    await releaseLock();
  }
}
