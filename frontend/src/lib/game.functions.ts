import { z } from "zod";
import type { Snapshot, LoadResult, Leaderboard, Referrals, ReferralClaim, AdStatus } from "./game.types";

const backendUrl = (import.meta.env["VITE_BACKEND_URL"] || "https://gramminer-backend.onrender.com").replace(/\/+$/, "");
const init = z.string().min(1).max(4096);
const withInit = z.object({ initData: init });
const minerInput = z.object({ initData: init, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData: init, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });

async function callBackend<T>(path: string, data?: unknown): Promise<T> {
  let response: Response;
  try {
    const request: RequestInit = {
      method: data === undefined ? "GET" : "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    };
    if (data !== undefined) {
      request.headers = { "content-type": "application/json" };
      request.body = JSON.stringify(data);
    }
    response = await fetch(backendUrl + path, request);
  } catch {
    throw new Error("Could not reach the backend. Check the Render service and VITE_BACKEND_URL.");
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

type DataInput<T> = { data: T };

export const loadGame = ({ data }: DataInput<unknown>) =>
  callBackend<LoadResult>("/api/game/load", withInit.parse(data));

export const claimBonus = ({ data }: DataInput<unknown>) =>
  callBackend<Snapshot>("/api/game/claim-bonus", withInit.parse(data));

export const buyMiner = ({ data }: DataInput<unknown>) =>
  callBackend<Snapshot>("/api/game/buy-miner", minerInput.parse(data));

export const claimMiner = ({ data }: DataInput<unknown>) =>
  callBackend<Snapshot>("/api/game/claim-miner", minerInput.parse(data));

export const donate = ({ data }: DataInput<unknown>) =>
  callBackend<Snapshot>("/api/game/donate", withInit.parse(data));

export const getLeaderboard = () =>
  callBackend<Leaderboard>("/api/game/leaderboard");

export const getReferrals = ({ data }: DataInput<unknown>) =>
  callBackend<Referrals>("/api/game/referrals", withInit.parse(data));

export const claimReferral = ({ data }: DataInput<unknown>) => {
  const parsed = z.object({ initData: init, friendId: z.number().int().positive() }).parse(data);
  return callBackend<ReferralClaim>("/api/game/claim-referral", parsed);
};

export const getWithdrawalStatus = ({ data }: DataInput<unknown>) =>
  callBackend<Snapshot>("/api/game/withdrawal-status", withInit.parse(data));

export const requestWithdraw = ({ data }: DataInput<unknown>) => {
  const parsed = z.object({
    initData: init,
    milli: z.number().int().min(30).max(1_000_000),
    address: z.string().min(40).max(80),
    idempotencyKey: z.string().regex(/^[a-f0-9-]{16,80}$/i),
  }).parse(data);
  return callBackend<Snapshot>("/api/game/withdraw", parsed);
};

export const startAd = ({ data }: DataInput<unknown>) => {
  const parsed = z.object({
    initData: init,
    abandonSessionId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  }).parse(data);
  return callBackend<{ sessionId: string; resumed: boolean }>("/api/game/start-ad", parsed);
};

export const markAdStarted = ({ data }: DataInput<unknown>) =>
  callBackend<{ ok: boolean }>("/api/game/mark-ad-started", sessionInput.parse(data));

export const cancelAd = ({ data }: DataInput<unknown>) =>
  callBackend<{ ok: boolean }>("/api/game/cancel-ad", sessionInput.parse(data));

export const adStatus = ({ data }: DataInput<unknown>) =>
  callBackend<AdStatus>("/api/game/ad-status", sessionInput.parse(data));
