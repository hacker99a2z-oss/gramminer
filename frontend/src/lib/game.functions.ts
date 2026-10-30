import { z } from "zod";
import type { Snapshot, LoadResult, Leaderboard, Referrals, ReferralClaim, AdStatus } from "./game.types";

const backendUrl = process.env["BACKEND_URL"]?.replace(/\/+$/, "");
const init = z.string().min(1).max(4096);
const withInit = z.object({ initData: init });
const minerInput = z.object({ initData: init, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData: init, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });

async function callBackend<T>(path: string, data?: unknown): Promise<T> {
  if (!backendUrl) {
    throw new Error("Backend is not configured. Set BACKEND_URL in the frontend hosting environment.");
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
    throw new Error("Could not reach the Gram Miner API. Check the backend service and BACKEND_URL.");
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

export async function loadGame(data: { initData: string }): Promise<LoadResult> {
  return callBackend<LoadResult>("/api/game/load", withInit.parse(data));
}

export async function claimBonus(data: { initData: string }): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/claim-bonus", withInit.parse(data));
}

export async function buyMiner(data: { initData: string; minerId: number }): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/buy-miner", minerInput.parse(data));
}

export async function claimMiner(data: { initData: string; minerId: number }): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/claim-miner", minerInput.parse(data));
}

export async function donate(data: { initData: string }): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/donate", withInit.parse(data));
}

export async function getLeaderboard(): Promise<Leaderboard> {
  return callBackend<Leaderboard>("/api/game/leaderboard");
}

export async function getReferrals(data: { initData: string }): Promise<Referrals> {
  return callBackend<Referrals>("/api/game/referrals", withInit.parse(data));
}

export async function claimReferral(data: { initData: string; friendId: number }): Promise<ReferralClaim> {
  return callBackend<ReferralClaim>("/api/game/claim-referral", z.object({ initData: init, friendId: z.number().int().positive() }).parse(data));
}

export async function getWithdrawalStatus(data: { initData: string }): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/withdrawal-status", withInit.parse(data));
}

export async function requestWithdraw(data: { initData: string; milli: number; address: string }): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/withdraw", z.object({
    initData: init,
    milli: z.number().int().min(30).max(1_000_000),
    address: z.string().min(40).max(80),
  }).parse(data));
}

export async function startAd(data: { initData: string; abandonSessionId?: string }): Promise<{ sessionId: string; resumed: boolean }> {
  return callBackend("/api/game/start-ad", z.object({
    initData: init,
    abandonSessionId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  }).parse(data));
}

export async function markAdStarted(data: { initData: string; sessionId: string }): Promise<{ ok: boolean }> {
  return callBackend("/api/game/mark-ad-started", sessionInput.parse(data));
}

export async function cancelAd(data: { initData: string; sessionId: string }): Promise<{ ok: boolean }> {
  return callBackend("/api/game/cancel-ad", sessionInput.parse(data));
}

export async function adStatus(data: { initData: string; sessionId: string }): Promise<AdStatus> {
  return callBackend("/api/game/ad-status", sessionInput.parse(data));
}
