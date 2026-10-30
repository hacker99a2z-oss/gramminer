import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const init = z.string().min(1).max(4096);
const withInit = z.object({ initData: init });
const minerInput = z.object({ initData: init, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData: init, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });

type GameService = typeof import("./game.server");
type Snapshot = Awaited<ReturnType<GameService["snapshot"]>>;
type LoadResult = Awaited<ReturnType<GameService["load"]>>;
type Leaderboard = Awaited<ReturnType<GameService["leaderboard"]>>;
type Referrals = Awaited<ReturnType<GameService["referrals"]>>;
type ReferralClaim = Awaited<ReturnType<GameService["claimReferral"]>>;
type AdStatus = Awaited<ReturnType<GameService["adStatus"]>>;

async function callBackend<T>(path: string, data?: unknown): Promise<T> {
  const backendUrl = process.env["BACKEND_URL"]?.replace(/\/+$/, "");
  if (!backendUrl) {
    throw new Error("Backend is not configured. Set BACKEND_URL in the Vercel project environment variables.");
  }

  let response: Response;
  try {
    response = await fetch(backendUrl + path, {
      method: data === undefined ? "GET" : "POST",
      headers: data === undefined ? undefined : { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach the backend. Check the Render service and BACKEND_URL.");
  }

  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { error: raw };
  }

  if (!response.ok) {
    const message =
      payload != null && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Backend request failed (" + response.status + ")";
    throw new Error(message);
  }

  return payload as T;
}

export const loadGame = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => callBackend<LoadResult>("/api/game/load", data));

export const claimBonus = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => callBackend<Snapshot>("/api/game/claim-bonus", data));

export const buyMiner = createServerFn({ method: "POST" })
  .inputValidator((d) => minerInput.parse(d))
  .handler(async ({ data }) => callBackend<Snapshot>("/api/game/buy-miner", data));

export const claimMiner = createServerFn({ method: "POST" })
  .inputValidator((d) => minerInput.parse(d))
  .handler(async ({ data }) => callBackend<Snapshot>("/api/game/claim-miner", data));

export const donate = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => callBackend<Snapshot>("/api/game/donate", data));

export const getLeaderboard = createServerFn({ method: "GET" })
  .handler(async () => callBackend<Leaderboard>("/api/game/leaderboard"));

export const getReferrals = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => callBackend<Referrals>("/api/game/referrals", data));

export const claimReferral = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ initData: init, friendId: z.number().int().positive() }).parse(d))
  .handler(async ({ data }) => callBackend<ReferralClaim>("/api/game/claim-referral", data));

export const requestWithdraw = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      initData: init,
      milli: z.number().int().min(100).max(1_000_000),
      address: z.string().min(40).max(80),
    }).parse(d),
  )
  .handler(async ({ data }) => callBackend<Snapshot>("/api/game/withdraw", data));

export const startAd = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      initData: init,
      abandonSessionId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => callBackend<{ sessionId: string; resumed: boolean }>("/api/game/start-ad", data));

export const markAdStarted = createServerFn({ method: "POST" })
  .inputValidator((d) => sessionInput.parse(d))
  .handler(async ({ data }) => callBackend<{ ok: boolean }>("/api/game/mark-ad-started", data));

export const cancelAd = createServerFn({ method: "POST" })
  .inputValidator((d) => sessionInput.parse(d))
  .handler(async ({ data }) => callBackend<{ ok: boolean }>("/api/game/cancel-ad", data));

export const adStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => sessionInput.parse(d))
  .handler(async ({ data }) => callBackend<AdStatus>("/api/game/ad-status", data));
