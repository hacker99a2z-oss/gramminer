import { Address } from "@ton/core";
import { supabaseAdmin } from "../integrations/supabase/client.server.ts";
import { AD_COOLDOWN_MS, LEADERBOARD_SIZE, MIN_WITHDRAW_MILLI, WITHDRAW_HISTORY_LIMIT, minerById } from "./rules.ts";
import { getBot, proofChannelUrl, verifyInitData, type TgUser } from "./tg.server.ts";
import { getTonUsd, runPayouts } from "./payout.server.ts";

const SESSION_TTL_MS = 5 * 60 * 1000;
const SESSION_RE = /^[a-f0-9]{32}$/;

function dbError(error: { message: string } | null) {
  if (!error) return;
  const msg = error.message.replace(/^.*?ERROR:\s*/, "");
  throw new Error(msg || "Request failed");
}

async function ensurePlayer(tg: TgUser) {
  const { data: existing } = await supabaseAdmin.from("players").select("tg_id").eq("tg_id", tg.id).maybeSingle();
  if (!existing) {
    const ref = /^ref_(\d{1,20})$/.exec(tg.start_param ?? "")?.[1];
    const refId = ref ? Number(ref) : null;
    let referredBy: number | null = null;
    if (refId && refId !== tg.id) {
      const { data: r } = await supabaseAdmin.from("players").select("tg_id").eq("tg_id", refId).maybeSingle();
      if (r) referredBy = refId;
    }
    await supabaseAdmin.from("players").upsert(
      { tg_id: tg.id, first_name: tg.first_name, username: tg.username ?? null, photo_url: tg.photo_url ?? null, referred_by: referredBy },
      { onConflict: "tg_id", ignoreDuplicates: true },
    );
  } else {
    await supabaseAdmin.from("players").update({ first_name: tg.first_name, username: tg.username ?? null, photo_url: tg.photo_url ?? null }).eq("tg_id", tg.id);
  }
}

export async function snapshot(tgId: number) {
  const [{ data: p, error }, { data: miners }, { data: wds }] = await Promise.all([
    supabaseAdmin.from("players").select("*").eq("tg_id", tgId).single(),
    supabaseAdmin.from("miners").select("miner_id, started_at").eq("tg_id", tgId),
    supabaseAdmin.from("withdrawals").select("id, amount_milli, nano, address, status, created_at").eq("tg_id", tgId).order("created_at", { ascending: false }).limit(WITHDRAW_HISTORY_LIMIT),
  ]);
  dbError(error);
  const today = new Date().toISOString().slice(0, 10);
  return {
    serverNow: Date.now(),
    coins: Number(p!.coins),
    balanceMilli: Number(p!.balance_milli),
    bonusAvailable: !p!.last_bonus_date || p!.last_bonus_date < today,
    nextAdAt: p!.last_ad_at ? new Date(p!.last_ad_at).getTime() + AD_COOLDOWN_MS : null,
    donatedCoins: Number(p!.donated_coins),
    miners: (miners ?? []).map((m) => ({ id: m.miner_id, startedAt: new Date(m.started_at).getTime() })),
    withdrawals: (wds ?? []).map((w) => ({
      id: w.id,
      milli: Number(w.amount_milli),
      ton: Number(BigInt(w.nano)) / 1e9,
      address: w.address,
      status: w.status,
      createdAt: new Date(w.created_at).getTime(),
    })),
  };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export async function auth(initData: string) {
  const tg = await verifyInitData(initData);
  return tg;
}

export async function load(initData: string) {
  const tg = await auth(initData);
  await ensurePlayer(tg);
  // Confirm in-flight payouts opportunistically (cheap when the queue is empty).
  const { count } = await supabaseAdmin.from("withdrawals").select("id", { count: "exact", head: true }).in("status", ["pending", "sending"]);
  if (count) await runPayouts();
  const bot = await getBot().catch(() => null);
  return { state: await snapshot(tg.id), botUsername: bot?.username ?? null, proofUrl: proofChannelUrl() };
}

export async function rpc(initData: string, fn: string, args: Record<string, unknown> = {}) {
  const tg = await auth(initData);
  const { error } = await supabaseAdmin.rpc(fn as never, { _tg: tg.id, ...args } as never);
  dbError(error);
  return snapshot(tg.id);
}

export async function buyMiner(initData: string, minerId: number) {
  if (!minerById(minerId)) throw new Error("Unknown miner");
  return rpc(initData, "gm_buy_miner", { _miner: minerId });
}
export async function claimMiner(initData: string, minerId: number) {
  if (!minerById(minerId)) throw new Error("Unknown miner");
  return rpc(initData, "gm_claim_miner", { _miner: minerId });
}

export async function leaderboard() {
  const { data } = await supabaseAdmin.from("players").select("tg_id, first_name, photo_url, donated_coins").gt("donated_coins", 0).order("donated_coins", { ascending: false }).limit(LEADERBOARD_SIZE);
  const { data: total } = await supabaseAdmin.from("players").select("donated_coins").gt("donated_coins", 0);
  return {
    top: (data ?? []).map((r) => ({ id: r.tg_id, name: r.first_name, photoUrl: r.photo_url, coins: Number(r.donated_coins) })),
    total: (total ?? []).reduce((s, r) => s + Number(r.donated_coins), 0),
  };
}

export async function referrals(initData: string) {
  const tg = await auth(initData);
  const { data } = await supabaseAdmin.from("players").select("tg_id, first_name, photo_url, owns_miner2, referral_claimed, created_at").eq("referred_by", tg.id).order("created_at", { ascending: false }).limit(200);
  return (data ?? []).map((r) => ({ id: r.tg_id, name: r.first_name, photoUrl: r.photo_url, eligible: r.owns_miner2, claimed: r.referral_claimed }));
}

export async function claimReferral(initData: string, friendId: number) {
  const tg = await auth(initData);
  const { error } = await supabaseAdmin.rpc("gm_claim_referral", { _tg: tg.id, _friend: friendId });
  if (error?.message.includes("NOT_ELIGIBLE")) return { ok: false as const, notEligible: true };
  dbError(error);
  return { ok: true as const, state: await snapshot(tg.id) };
}

export async function withdraw(initData: string, milli: number, address: string) {
  const tg = await auth(initData);
  if (!Number.isInteger(milli) || milli < MIN_WITHDRAW_MILLI) throw new Error("Minimum withdraw is $0.10");
  let friendly: string;
  try {
    friendly = Address.parse(address).toString({ bounceable: false });
  } catch {
    throw new Error("Invalid wallet address");
  }
  const price = await getTonUsd();
  const nano = BigInt(Math.floor((milli / 1000 / price) * 1e9));
  const { error } = await supabaseAdmin.rpc("gm_request_withdraw", { _tg: tg.id, _milli: milli, _nano: nano.toString(), _address: friendly });
  dbError(error);
  await runPayouts();
  return snapshot(tg.id);
}

// ---------- AdsGram rewarded ad sessions (server-verified, as in the original app) ----------
export async function startAd(initData: string, abandonSessionId?: string) {
  const tg = await auth(initData);
  if (!process.env["ADSGRAM_REWARD_SECRET"]) throw new Error("Rewarded ads are not configured");
  const now = Date.now();
  const { data: s } = await supabaseAdmin.from("ad_sessions").select("*").eq("tg_id", tg.id).maybeSingle();
  if (s && s.status === "pending") {
    const expired = new Date(s.expires_at).getTime() <= now;
    if (abandonSessionId && s.session_id === abandonSessionId) {
      await supabaseAdmin.from("ad_sessions").update({ status: "cancelled" }).eq("tg_id", tg.id).eq("session_id", abandonSessionId);
    } else if (!expired) {
      return { sessionId: s.session_id, resumed: s.phase === "playing" };
    }
  }
  const { data: p } = await supabaseAdmin.from("players").select("last_ad_at").eq("tg_id", tg.id).single();
  if (p?.last_ad_at && new Date(p.last_ad_at).getTime() + AD_COOLDOWN_MS > now) throw new Error("Please wait for the timer to finish");
  const sessionId = crypto.randomUUID().replace(/-/g, "");
  await supabaseAdmin.from("ad_sessions").upsert({
    tg_id: tg.id,
    session_id: sessionId,
    status: "pending",
    phase: "reserved",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    verified_at: null,
  });
  return { sessionId, resumed: false };
}

export async function adSessionUpdate(initData: string, sessionId: string, action: "started" | "cancel") {
  if (!SESSION_RE.test(sessionId)) throw new Error("Invalid ad request");
  const tg = await auth(initData);
  const patch = action === "started" ? { phase: "playing" } : { status: "cancelled" };
  await supabaseAdmin.from("ad_sessions").update(patch).eq("tg_id", tg.id).eq("session_id", sessionId).eq("status", "pending");
  return { ok: true };
}

export async function adStatus(initData: string, sessionId: string) {
  if (!SESSION_RE.test(sessionId)) throw new Error("Invalid ad request");
  const tg = await auth(initData);
  const { data: s } = await supabaseAdmin.from("ad_sessions").select("*").eq("tg_id", tg.id).maybeSingle();
  if (!s || s.session_id !== sessionId) throw new Error("Ad session not found");
  if (s.status === "verified") return { verified: true, expired: false, state: await snapshot(tg.id) };
  const expired = s.status !== "pending" || new Date(s.expires_at).getTime() <= Date.now();
  return { verified: false, expired, state: null };
}
