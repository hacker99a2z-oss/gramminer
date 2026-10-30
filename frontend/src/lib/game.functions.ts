import { z } from "zod";
import type { Snapshot, LoadResult, Leaderboard, Referrals, ReferralClaim, AdStatus } from "./game.types";

const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || "https://gramminer-backend.onrender.com").replace(/\/+$/, "");
const init = z.string().min(1).max(4096);
const withInit = z.object({ initData: init });
const minerInput = z.object({ initData: init, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData: init, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });

type Input<T> = { data: T };

async function callBackend<T>(path: string, data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method: data === undefined ? "GET" : "POST",
      headers: data === undefined ? undefined : { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store",
      mode: "cors",
    });
  } catch {
    throw new Error("Could not reach the Gram Miner API. Check your connection and backend service.");
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

// These calls run directly in the Mini App browser. The Cloud Run API remains
// the source of truth and validates Telegram initData and every balance change.
export async function loadGame({ data }: Input<{ initData: string }>): Promise<LoadResult> {
  return callBackend<LoadResult>("/api/game/load", withInit.parse(data));
}

export async function claimBonus({ data }: Input<{ initData: string }>): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/claim-bonus", withInit.parse(data));
}

export async function buyMiner({ data }: Input<{ initData: string; minerId: number }>): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/buy-miner", minerInput.parse(data));
}

export async function claimMiner({ data }: Input<{ initData: string; minerId: number }>): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/claim-miner", minerInput.parse(data));
}

export async function donate({ data }: Input<{ initData: string }>): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/donate", withInit.parse(data));
}

export async function getLeaderboard(): Promise<Leaderboard> {
  return callBackend<Leaderboard>("/api/game/leaderboard");
}

export async function getReferrals({ data }: Input<{ initData: string }>): Promise<Referrals> {
  return callBackend<Referrals>("/api/game/referrals", withInit.parse(data));
}

export async function claimReferral({ data }: Input<{ initData: string; friendId: number }>): Promise<ReferralClaim> {
  const input = z.object({ initData: init, friendId: z.number().int().positive() }).parse(data);
  return callBackend<ReferralClaim>("/api/game/claim-referral", input);
}

export async function getWithdrawalStatus({ data }: Input<{ initData: string }>): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/withdrawal-status", withInit.parse(data));
}

export async function requestWithdraw({ data }: Input<{ initData: string; milli: number; address: string }>): Promise<Snapshot> {
  const input = z.object({
    initData,
    milli: z.number().int().min(30).max(1_000_000),
    address: z.string().min(40).max(80),
  }).parse(data);
  return callBackend<Snapshot>("/api/game/withdraw", input);
}

export async function startAd({ data }: Input<{ initData: string; abandonSessionId?: string }>): Promise<{ sessionId: string; resumed: boolean }> {
  const input = z.object({
    initData,
    abandonSessionId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  }).parse(data);
  return callBackend("/api/game/start-ad", input);
}

export async function markAdStarted({ data }: Input<{ initData: string; sessionId: string }>): Promise<{ ok: boolean }> {
  return callBackend("/api/game/mark-ad-started", sessionInput.parse(data));
}

export async function cancelAd({ data }: Input<{ initData: string; sessionId: string }>): Promise<{ ok: boolean }> {
  return callBackend("/api/game/cancel-ad", sessionInput.parse(data));
}

export async function adStatus({ data }: Input<{ initData: string; sessionId: string }>): Promise<AdStatus> {
  return callBackend("/api/game/ad-status", sessionInput.parse(data));
}
