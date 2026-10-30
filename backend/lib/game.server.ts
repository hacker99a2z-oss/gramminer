import { Address } from "@ton/core";
import { getDb, withWriteTransaction, asRow, asNumber, asText } from "./db.server.ts";
import { AD_COOLDOWN_MS, LEADERBOARD_SIZE, MIN_WITHDRAW_MILLI, WITHDRAW_HISTORY_LIMIT, minerById } from "./rules.ts";
import { getBot, proofChannelUrl, verifyInitData, type TgUser } from "./tg.server.ts";
import { getTonUsd } from "./payout.server.ts";

const SESSION_TTL_MS = 5 * 60 * 1000;
const SESSION_RE = /^[a-f0-9]{32}$/;

type LeaderboardPayload = {
  top: Array<{ id: number; name: string; photoUrl: string | null; coins: number }>;
  total: number;
};

const LEADERBOARD_CACHE_TTL_MS = 15_000;
let leaderboardCache: { expiresAt: number; value: LeaderboardPayload } | null = null;
let leaderboardInFlight: Promise<LeaderboardPayload> | null = null;

function requireChanged(rowsAffected: number, message: string) {
  if (rowsAffected < 1) throw new Error(message);
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

async function ensurePlayer(tg: TgUser) {
  // A single conditional UPSERT keeps returning-player loads lightweight:
  // unchanged profiles do not generate a database write.
  const refText = tg.start_param?.startsWith("ref_") ? tg.start_param.slice(4) : "";
  const parsedRefId = refText.length > 0 && refText.length <= 20 &&
      [...refText].every((char) => char >= "0" && char <= "9")
    ? Number(refText)
    : null;
  const refId = parsedRefId && Number.isSafeInteger(parsedRefId) && parsedRefId !== tg.id
    ? parsedRefId
    : null;
  const username = tg.username ?? null;
  const photoUrl = tg.photo_url ?? null;

  await getDb().execute({
    sql: `INSERT INTO players
      (tg_id, first_name, username, photo_url, referred_by, created_at)
      VALUES (?, ?, ?, ?, CASE
        WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM players WHERE tg_id = ?) THEN ?
        ELSE NULL
      END, ?)
      ON CONFLICT(tg_id) DO UPDATE SET
        first_name = excluded.first_name,
        username = excluded.username,
        photo_url = excluded.photo_url
      WHERE players.first_name IS NOT excluded.first_name
        OR players.username IS NOT excluded.username
        OR players.photo_url IS NOT excluded.photo_url`,
    args: [
      tg.id,
      tg.first_name,
      username,
      photoUrl,
      refId,
      refId,
      refId,
      new Date().toISOString(),
    ],
  });
}

export async function snapshot(tgId: number) {
  const db = getDb();
  const [playerResult, minerResult, withdrawalResult] = await Promise.all([
    db.execute({ sql: "SELECT * FROM players WHERE tg_id = ?", args: [tgId] }),
    db.execute({ sql: "SELECT miner_id, started_at FROM miners WHERE tg_id = ? ORDER BY miner_id", args: [tgId] }),
    db.execute({
      sql: "SELECT id, amount_milli, nano, address, status, created_at, proof_message_url FROM withdrawals WHERE tg_id = ? ORDER BY created_at DESC LIMIT ?",
      args: [tgId, WITHDRAW_HISTORY_LIMIT],
    }),
  ]);

  if (!playerResult.rows.length) throw new Error("Player not found");
  const player = asRow(playerResult.rows[0]);
  const today = utcDate();

  return {
    serverNow: Date.now(),
    coins: asNumber(player["coins"]),
    balanceMilli: asNumber(player["balance_milli"]),
    bonusAvailable: !player["last_bonus_date"] || asText(player["last_bonus_date"]) < today,
    nextAdAt: player["last_ad_at"]
      ? new Date(asText(player["last_ad_at"])).getTime() + AD_COOLDOWN_MS
      : null,
    donatedCoins: asNumber(player["donated_coins"]),
    miners: minerResult.rows.map((value) => {
      const miner = asRow(value);
      return { id: asNumber(miner["miner_id"]), startedAt: new Date(asText(miner["started_at"])).getTime() };
    }),
    withdrawals: withdrawalResult.rows.map((value) => {
      const withdrawal = asRow(value);
      return {
        id: asText(withdrawal["id"]),
        milli: asNumber(withdrawal["amount_milli"]),
        ton: Number(BigInt(asText(withdrawal["nano"]))) / 1e9,
        address: asText(withdrawal["address"]),
        status: asText(withdrawal["status"]),
        createdAt: new Date(asText(withdrawal["created_at"])).getTime(),
        proofMessageUrl: withdrawal["proof_message_url"] ? asText(withdrawal["proof_message_url"]) : null,
      };
    }),
  };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export async function auth(initData: string) {
  return verifyInitData(initData);
}

export async function load(initData: string) {
  const tg = await auth(initData);
  await ensurePlayer(tg);

  // Payout processing must never run in the interactive game-load path.
  const bot = await getBot().catch(() => null);
  return { state: await snapshot(tg.id), botUsername: bot?.username ?? null, proofUrl: proofChannelUrl() };
}

export async function claimBonus(initData: string) {
  const tg = await auth(initData);
  await withWriteTransaction(async (tx) => {
    const result = await tx.execute({
      sql: `UPDATE players SET coins = coins + 100, last_bonus_date = ?
        WHERE tg_id = ? AND (last_bonus_date IS NULL OR last_bonus_date < ?)`,
      args: [utcDate(), tg.id, utcDate()],
    });
    requireChanged(result.rowsAffected, "Daily bonus already claimed today");
  });
  return snapshot(tg.id);
}

export async function buyMiner(initData: string, minerId: number) {
  const tg = await auth(initData);
  const rule = minerById(minerId);
  if (!rule) throw new Error("Unknown miner");

  await withWriteTransaction(async (tx) => {
    const existing = await tx.execute({
      sql: "SELECT miner_id FROM miners WHERE tg_id = ? AND miner_id = ?",
      args: [tg.id, minerId],
    });
    if (existing.rows.length) throw new Error("You already own this miner");

    const result = await tx.execute({
      sql: `UPDATE players
        SET coins = coins - ?, owns_miner2 = CASE WHEN ? = 2 THEN 1 ELSE owns_miner2 END
        WHERE tg_id = ? AND coins >= ?`,
      args: [rule.cost, minerId, tg.id, rule.cost],
    });
    requireChanged(result.rowsAffected, "Not enough coins");

    await tx.execute({
      sql: "INSERT INTO miners(tg_id, miner_id, started_at) VALUES (?, ?, ?)",
      args: [tg.id, minerId, new Date().toISOString()],
    });
  });
  return snapshot(tg.id);
}

export async function claimMiner(initData: string, minerId: number) {
  const tg = await auth(initData);
  const rule = minerById(minerId);
  if (!rule) throw new Error("Unknown miner");

  await withWriteTransaction(async (tx) => {
    const started = await tx.execute({
      sql: "SELECT started_at FROM miners WHERE tg_id = ? AND miner_id = ?",
      args: [tg.id, minerId],
    });
    if (!started.rows.length) throw new Error("You do not own this miner");

    const startedAt = asText(asRow(started.rows[0])["started_at"]);
    const now = Date.now();
    if (!Number.isFinite(Date.parse(startedAt)) || Date.parse(startedAt) + rule.minutes * 60_000 > now) {
      throw new Error("Mining is not finished yet");
    }

    const update = await tx.execute({
      sql: "UPDATE miners SET started_at = ? WHERE tg_id = ? AND miner_id = ? AND started_at = ?",
      args: [new Date(now).toISOString(), tg.id, minerId, startedAt],
    });
    requireChanged(update.rowsAffected, "Mining has already been claimed; refresh and try again");

    const credit = await tx.execute({
      sql: "UPDATE players SET balance_milli = balance_milli + ? WHERE tg_id = ?",
      args: [rule.rewardMilli, tg.id],
    });
    requireChanged(credit.rowsAffected, "Player not found");
  });
  return snapshot(tg.id);
}

export async function donate(initData: string) {
  const tg = await auth(initData);
  await withWriteTransaction(async (tx) => {
    const result = await tx.execute({
      sql: "UPDATE players SET coins = coins - 100, donated_coins = donated_coins + 100 WHERE tg_id = ? AND coins >= 100",
      args: [tg.id],
    });
    requireChanged(result.rowsAffected, "You need 100 coins to donate");
  });
  leaderboardCache = null;
  return snapshot(tg.id);
}

async function fetchLeaderboard(): Promise<LeaderboardPayload> {
  const db = getDb();
  const [topResult, totalResult] = await Promise.all([
    db.execute({
      sql: "SELECT tg_id, first_name, photo_url, donated_coins FROM players WHERE donated_coins > 0 ORDER BY donated_coins DESC LIMIT ?",
      args: [LEADERBOARD_SIZE],
    }),
    db.execute("SELECT COALESCE(SUM(donated_coins), 0) AS total FROM players WHERE donated_coins > 0"),
  ]);

  return {
    top: topResult.rows.map((value) => {
      const row = asRow(value);
      return {
        id: asNumber(row["tg_id"]),
        name: asText(row["first_name"]),
        photoUrl: row["photo_url"] ? asText(row["photo_url"]) : null,
        coins: asNumber(row["donated_coins"]),
      };
    }),
    total: asNumber(asRow(totalResult.rows[0])["total"]),
  };
}

export async function leaderboard(): Promise<LeaderboardPayload> {
  const now = Date.now();
  if (leaderboardCache && leaderboardCache.expiresAt > now) {
    return leaderboardCache.value;
  }

  // Collapse concurrent refreshes into one pair of Turso queries per instance.
  if (!leaderboardInFlight) {
    const request = fetchLeaderboard();
    leaderboardInFlight = request.then((value) => {
      leaderboardCache = {
        value,
        expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS,
      };
      return value;
    }).finally(() => {
      leaderboardInFlight = null;
    });
  }

  return leaderboardInFlight;
}

export async function referrals(initData: string) {
  const tg = await auth(initData);
  const result = await getDb().execute({
    sql: `SELECT tg_id, first_name, photo_url, owns_miner2, referral_claimed
      FROM players WHERE referred_by = ? ORDER BY created_at DESC LIMIT 200`,
    args: [tg.id],
  });
  return result.rows.map((value) => {
    const row = asRow(value);
    return {
      id: asNumber(row["tg_id"]),
      name: asText(row["first_name"]),
      photoUrl: row["photo_url"] ? asText(row["photo_url"]) : null,
      eligible: asNumber(row["owns_miner2"]) === 1,
      claimed: asNumber(row["referral_claimed"]) === 1,
    };
  });
}

export async function claimReferral(initData: string, friendId: number) {
  const tg = await auth(initData);
  try {
    await withWriteTransaction(async (tx) => {
      const friendResult = await tx.execute({
        sql: "SELECT owns_miner2, referral_claimed FROM players WHERE tg_id = ? AND referred_by = ?",
        args: [friendId, tg.id],
      });
      if (!friendResult.rows.length) throw new Error("Referral not found");

      const friend = asRow(friendResult.rows[0]);
      if (asNumber(friend["referral_claimed"]) === 1) throw new Error("Already claimed");
      if (asNumber(friend["owns_miner2"]) !== 1) throw new Error("NOT_ELIGIBLE");

      const update = await tx.execute({
        sql: "UPDATE players SET referral_claimed = 1 WHERE tg_id = ? AND referred_by = ? AND referral_claimed = 0",
        args: [friendId, tg.id],
      });
      requireChanged(update.rowsAffected, "Already claimed");

      const credit = await tx.execute({
        sql: "UPDATE players SET coins = coins + 100 WHERE tg_id = ?",
        args: [tg.id],
      });
      requireChanged(credit.rowsAffected, "Referrer not found");
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_ELIGIBLE") {
      return { ok: false as const, notEligible: true };
    }
    throw error;
  }
  return { ok: true as const, state: await snapshot(tg.id) };
}

export async function withdraw(initData: string, milli: number, address: string) {
  const tg = await auth(initData);
  if (!Number.isInteger(milli) || milli < MIN_WITHDRAW_MILLI) {
    throw new Error("Minimum withdraw is $0.03");
  }

  let friendly: string;
  try {
    friendly = Address.parse(address).toString({ bounceable: false });
  } catch {
    throw new Error("Invalid wallet address");
  }

  const price = await getTonUsd();
  const nano = BigInt(Math.floor((milli / 1000 / price) * 1e9)).toString();
  const withdrawalId = crypto.randomUUID();
  await withWriteTransaction(async (tx) => {
    const debit = await tx.execute({
      sql: "UPDATE players SET balance_milli = balance_milli - ? WHERE tg_id = ? AND balance_milli >= ?",
      args: [milli, tg.id, milli],
    });
    requireChanged(debit.rowsAffected, "Not enough balance");

    await tx.execute({
      sql: `INSERT INTO withdrawals(id, tg_id, amount_milli, nano, address, status, batch_id, proof_posted, created_at, sent_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0, ?, NULL)`,
      args: [withdrawalId, tg.id, milli, nano, friendly, new Date().toISOString()],
    });
  });

  // The scheduled payout processor picks up this durable pending withdrawal.
  return snapshot(tg.id);
}

export async function withdrawalStatus(initData: string) {
  const tg = await auth(initData);
  return snapshot(tg.id);
}

// ---------- AdsGram rewarded ad sessions (server-verified) ----------
export async function startAd(initData: string, abandonSessionId?: string) {
  const tg = await auth(initData);
  if (!process.env["ADSGRAM_REWARD_SECRET"]) throw new Error("Rewarded ads are not configured");

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const sessionId = crypto.randomUUID().replace(/-/g, "");
  const result = await withWriteTransaction(async (tx) => {
    const sessionResult = await tx.execute({ sql: "SELECT * FROM ad_sessions WHERE tg_id = ?", args: [tg.id] });
    if (sessionResult.rows.length) {
      const session = asRow(sessionResult.rows[0]);
      if (asText(session["status"]) === "pending") {
        const expired = new Date(asText(session["expires_at"])).getTime() <= now;
        if (abandonSessionId && asText(session["session_id"]) === abandonSessionId) {
          await tx.execute({
            sql: "UPDATE ad_sessions SET status = 'cancelled' WHERE tg_id = ? AND session_id = ? AND status = 'pending'",
            args: [tg.id, abandonSessionId],
          });
        } else if (!expired) {
          return { sessionId: asText(session["session_id"]), resumed: asText(session["phase"]) === "playing" };
        }
      }
    }

    const player = await tx.execute({ sql: "SELECT last_ad_at FROM players WHERE tg_id = ?", args: [tg.id] });
    if (!player.rows.length) throw new Error("Player not found");
    const lastAdAt = asRow(player.rows[0])["last_ad_at"];
    if (lastAdAt && new Date(asText(lastAdAt)).getTime() + AD_COOLDOWN_MS > now) {
      throw new Error("Please wait for the timer to finish");
    }

    await tx.execute({
      sql: `INSERT INTO ad_sessions(tg_id, session_id, status, phase, created_at, expires_at, verified_at)
        VALUES (?, ?, 'pending', 'reserved', ?, ?, NULL)
        ON CONFLICT(tg_id) DO UPDATE SET
          session_id = excluded.session_id,
          status = 'pending',
          phase = 'reserved',
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          verified_at = NULL`,
      args: [tg.id, sessionId, nowIso, new Date(now + SESSION_TTL_MS).toISOString()],
    });
    return { sessionId, resumed: false };
  });
  return result;
}

export async function adSessionUpdate(initData: string, sessionId: string, action: "started" | "cancel") {
  if (!SESSION_RE.test(sessionId)) throw new Error("Invalid ad request");
  const tg = await auth(initData);
  const patch = action === "started"
    ? "UPDATE ad_sessions SET phase = 'playing' WHERE tg_id = ? AND session_id = ? AND status = 'pending'"
    : "UPDATE ad_sessions SET status = 'cancelled' WHERE tg_id = ? AND session_id = ? AND status = 'pending'";
  const result = await getDb().execute({ sql: patch, args: [tg.id, sessionId] });
  if (action === "started") {
    requireChanged(result.rowsAffected, "Ad session is no longer active. Tap Watch Ad again.");
  }
  return { ok: true };
}

export async function adStatus(initData: string, sessionId: string) {
  if (!SESSION_RE.test(sessionId)) throw new Error("Invalid ad request");
  const tg = await auth(initData);
  const result = await getDb().execute({ sql: "SELECT * FROM ad_sessions WHERE tg_id = ?", args: [tg.id] });
  if (!result.rows.length) throw new Error("Ad session not found");

  const session = asRow(result.rows[0]);
  if (asText(session["session_id"]) !== sessionId) throw new Error("Ad session not found");
  if (asText(session["status"]) === "verified") {
    return { verified: true, expired: false, state: await snapshot(tg.id) };
  }
  const expired = asText(session["status"]) !== "pending" || new Date(asText(session["expires_at"])).getTime() <= Date.now();
  return { verified: false, expired, state: null };
}

export async function rewardAd(tgId: number): Promise<string> {
  return withWriteTransaction(async (tx) => {
    const sessionResult = await tx.execute({ sql: "SELECT * FROM ad_sessions WHERE tg_id = ?", args: [tgId] });
    if (!sessionResult.rows.length) return "no_session";

    const session = asRow(sessionResult.rows[0]);
    if (asText(session["status"]) === "verified") return "already";
    if (asText(session["status"]) !== "pending" || new Date(asText(session["expires_at"])).getTime() <= Date.now()) {
      return "expired";
    }
    // AdsGram's Reward URL is the only path that grants coins. Also require
    // this authenticated player's reserved session to have been marked as
    // started before the client was allowed to display the rewarded ad.
    if (asText(session["phase"]) !== "playing") return "not_started";

    const playerResult = await tx.execute({ sql: "SELECT last_ad_at, last_ad_session_id FROM players WHERE tg_id = ?", args: [tgId] });
    if (!playerResult.rows.length) return "no_session";
    const player = asRow(playerResult.rows[0]);
    const currentSessionId = asText(session["session_id"]);

    if (player["last_ad_session_id"] === currentSessionId) {
      await tx.execute({
        sql: "UPDATE ad_sessions SET status = 'verified', verified_at = ? WHERE tg_id = ? AND session_id = ?",
        args: [new Date().toISOString(), tgId, currentSessionId],
      });
      return "already";
    }
    if (player["last_ad_at"] && new Date(asText(player["last_ad_at"])).getTime() + AD_COOLDOWN_MS > Date.now()) {
      return "cooldown";
    }

    const now = new Date().toISOString();
    const credit = await tx.execute({
      sql: "UPDATE players SET coins = coins + 100, last_ad_at = ?, last_ad_session_id = ? WHERE tg_id = ?",
      args: [now, currentSessionId, tgId],
    });
    requireChanged(credit.rowsAffected, "Player not found");

    await tx.execute({
      sql: "UPDATE ad_sessions SET status = 'verified', verified_at = ? WHERE tg_id = ? AND session_id = ? AND status = 'pending'",
      args: [now, tgId, currentSessionId],
    });
    return "ok";
  });
}
