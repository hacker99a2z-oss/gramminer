import { z } from "zod";
import type { Snapshot, LoadResult, Leaderboard, Referrals, ReferralClaim, AdStatus } from "./game.types";

const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || "https://gramminer-backend.onrender.com").replace(/\/+$/, "");
const init = z.string().min(1).max(4096);
const withInit = z.object({ initData: init });
const minerInput = z.object({ initData: init, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData: init, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });
type Input<T> = { data: T };
type GameAction =
  | { id: string; type: "claim-bonus" }
  | { id: string; type: "buy-miner"; minerId: number }
  | { id: string; type: "claim-miner"; minerId: number }
  | { id: string; type: "donate" }
  | { id: string; type: "claim-referral"; friendId: number };
type GameActionResult = {
  actionId: string;
  type: GameAction["type"];
  ok: boolean;
  duplicate?: boolean;
  data?: { ok?: boolean; notEligible?: boolean };
  error?: string;
};
type SyncResponse = { results: GameActionResult[]; state: Snapshot };
type PendingAction = {
  action: GameAction;
  waiters: Array<{
    resolve: (value: { state: Snapshot; result: GameActionResult }) => void;
    reject: (error: Error) => void;
  }>;
};
const actionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("claim-bonus") }).strict(),
  z.object({ id: z.string().uuid(), type: z.literal("buy-miner"), minerId: z.number().int().min(1).max(5) }).strict(),
  z.object({ id: z.string().uuid(), type: z.literal("claim-miner"), minerId: z.number().int().min(1).max(5) }).strict(),
  z.object({ id: z.string().uuid(), type: z.literal("donate") }).strict(),
  z.object({ id: z.string().uuid(), type: z.literal("claim-referral"), friendId: z.number().int().positive() }).strict(),
]);
const MAX_BATCH = 5;
const BATCH_DELAY_MS = 1200;
const CHECKPOINT_MS = 15000;
const QUEUE_STORAGE_PREFIX = "gramminer:pending-game-actions:v1:";
let queueUserId: number | null = null;
let queue: PendingAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let checkpointTimer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | null = null;
let currentInitData: string | null = null;
let stateListener: ((state: Snapshot) => void) | null = null;
let lastBeaconPayload = "";
let lastBeaconAt = 0;

function getTelegramUserId(initData: string): number {
  try {
    const rawUser = new URLSearchParams(initData).get("user");
    const id = rawUser ? (JSON.parse(rawUser) as { id?: unknown }).id : undefined;
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return id;
  } catch {
    // Telegram initData is verified again on the server; this ID only scopes local storage.
  }
  throw new Error("Could not identify the Telegram account. Reopen Gram Miner inside Telegram.");
}

function storageKey(userId: number): string {
  return QUEUE_STORAGE_PREFIX + String(userId);
}

function persistQueue(): void {
  if (typeof window === "undefined" || queueUserId === null) return;
  try {
    localStorage.setItem(storageKey(queueUserId), JSON.stringify(queue.map((item) => item.action)));
  } catch (error) {
    console.warn("[game-sync] Could not persist pending commands on this device", error);
  }
}

function activateQueue(initData: string): number {
  const userId = getTelegramUserId(initData);
  if (queueUserId !== userId) {
    // Never switch the active account while its request or UI action promises
    // are still in flight. Persisted, unacknowledged commands are scoped to
    // their original Telegram user and may be resumed after a full WebView reload.
    if (inFlight || queue.some((item) => item.waiters.length > 0)) {
      throw new Error("A previous Telegram account still has pending actions. Close and reopen Gram Miner to switch accounts safely.");
    }
    if (queueUserId !== null) persistQueue();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    queueUserId = userId;
    queue = [];
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(storageKey(userId));
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          const validated = z.array(actionSchema).max(500).safeParse(parsed);
          if (validated.success) queue = validated.data.map((action) => ({ action, waiters: [] }));
          else localStorage.removeItem(storageKey(userId));
        }
      } catch {
        try { localStorage.removeItem(storageKey(userId)); } catch { /* unavailable */ }
      }
    }
  }
  currentInitData = initData;
  if (!checkpointTimer && typeof window !== "undefined") {
    checkpointTimer = window.setInterval(() => {
      if (currentInitData && queue.length) void flushPendingGameActions(currentInitData).catch(() => undefined);
    }, CHECKPOINT_MS);
  }
  return userId;
}

async function callBackend<T>(path: string, data?: unknown, keepalive = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method: data === undefined ? "GET" : "POST",
      headers: data === undefined ? undefined : { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store",
      mode: "cors",
      keepalive,
    });
  } catch {
    throw new Error("Could not reach the Gram Miner API. Pending commands remain saved on this device.");
  }
  const raw = await response.text();
  let payload: unknown = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { error: raw }; }
  if (!response.ok) {
    const message =
      payload != null && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Backend request failed (" + response.status + ")";
    throw new Error(message);
  }
  return payload as T;
}

export function setGameActionStateListener(listener: ((state: Snapshot) => void) | null): void {
  stateListener = listener;
}

async function sendActionBatch(initData: string, batch: PendingAction[]): Promise<void> {
  const response = await callBackend<SyncResponse>("/api/game/sync", {
    initData,
    actions: batch.map((item) => item.action),
  });
  const results = new Map(response.results.map((result) => [result.actionId, result]));
  const completed = new Set(batch.filter((item) => results.has(item.action.id)).map((item) => item.action.id));
  queue = queue.filter((item) => !completed.has(item.action.id));
  persistQueue();
  stateListener?.(response.state);
  for (const item of batch) {
    const result = results.get(item.action.id);
    if (!result) {
      const error = new Error("The server did not acknowledge a queued command. It remains saved for retry.");
      const waiters = item.waiters.splice(0);
      waiters.forEach((waiter) => waiter.reject(error));
      continue;
    }
    item.waiters.forEach((waiter) => waiter.resolve({ state: response.state, result }));
  }
}

export async function flushPendingGameActions(initData: string): Promise<void> {
  activateQueue(initData);
  if (inFlight) return inFlight;
  if (!queue.length) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  const batch = queue.slice(0, MAX_BATCH);
  inFlight = sendActionBatch(initData, batch)
    .then(() => {
      if (queue.length) scheduleBatch(initData);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error : new Error("Game sync failed");
      for (const item of batch) {
        const waiters = item.waiters.splice(0);
        waiters.forEach((waiter) => waiter.reject(message));
      }
      persistQueue();
      throw message;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function scheduleBatch(initData: string): void {
  if (flushTimer || inFlight) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushPendingGameActions(initData).catch((error: unknown) => {
      console.warn("[game-sync] Batch checkpoint failed; will retry", error);
    });
  }, BATCH_DELAY_MS);
}

function enqueueGameAction(
  initData: string,
  action: Omit<GameAction, "id">,
): Promise<{ state: Snapshot; result: GameActionResult }> {
  activateQueue(initData);
  const completeAction = actionSchema.parse({ ...action, id: crypto.randomUUID() }) as GameAction;
  return new Promise((resolve, reject) => {
    queue.push({ action: completeAction, waiters: [{ resolve, reject }] });
    persistQueue();
    if (queue.length >= MAX_BATCH) {
      void flushPendingGameActions(initData).catch((error: unknown) => {
        console.warn("[game-sync] Batch checkpoint failed; commands remain queued", error);
      });
    } else {
      scheduleBatch(initData);
    }
  });
}

async function runQueuedAction(initData: string, action: Omit<GameAction, "id">): Promise<{
  state: Snapshot;
  result: GameActionResult;
}> {
  return enqueueGameAction(initData, action);
}

export function flushPendingGameActionsWithBeacon(initData: string): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  try {
    activateQueue(initData);
    if (!queue.length) return;
    const payload = JSON.stringify({
      initData,
      actions: queue.slice(0, MAX_BATCH).map((item) => item.action),
    });
    if (payload === lastBeaconPayload && Date.now() - lastBeaconAt < 1500) return;
    lastBeaconPayload = payload;
    lastBeaconAt = Date.now();
    const blob = new Blob([payload], { type: "text/plain;charset=UTF-8" });
    const accepted = navigator.sendBeacon?.(API_BASE_URL + "/api/game/sync", blob) ?? false;
    if (!accepted) {
      void fetch(API_BASE_URL + "/api/game/sync", {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: payload,
        keepalive: true,
        mode: "cors",
        cache: "no-store",
      }).catch(() => undefined);
    }
    // Keep local storage until a normal response acknowledges the commands.
    // Replaying identical IDs after a beacon is safe because the DB receipts are idempotent.
  } catch (error) {
    console.warn("[game-sync] Exit checkpoint could not be sent; commands remain saved", error);
  }
}

export async function resumePendingGameActions(initData: string): Promise<void> {
  activateQueue(initData);
  if (!queue.length) return;
  try { await flushPendingGameActions(initData); }
  catch (error) { console.warn("[game-sync] Saved commands remain pending", error); }
}

function requireSuccessfulAction(response: { state: Snapshot; result: GameActionResult }): Snapshot {
  if (!response.result.ok) throw new Error(response.result.error ?? "The game action was rejected by the server");
  return response.state;
}

export async function loadGame({ data }: Input<{ initData: string }>): Promise<LoadResult> {
  return callBackend<LoadResult>("/api/game/load", withInit.parse(data));
}

export async function claimBonus({ data }: Input<{ initData: string }>): Promise<Snapshot> {
  return requireSuccessfulAction(await runQueuedAction(data.initData, { type: "claim-bonus" }));
}

export async function buyMiner({ data }: Input<{ initData: string; minerId: number }>): Promise<Snapshot> {
  const input = minerInput.parse(data);
  return requireSuccessfulAction(await runQueuedAction(input.initData, { type: "buy-miner", minerId: input.minerId }));
}

export async function claimMiner({ data }: Input<{ initData: string; minerId: number }>): Promise<Snapshot> {
  const input = minerInput.parse(data);
  return requireSuccessfulAction(await runQueuedAction(input.initData, { type: "claim-miner", minerId: input.minerId }));
}

export async function donate({ data }: Input<{ initData: string }>): Promise<Snapshot> {
  return requireSuccessfulAction(await runQueuedAction(data.initData, { type: "donate" }));
}

export async function getLeaderboard(): Promise<Leaderboard> {
  return callBackend<Leaderboard>("/api/game/leaderboard");
}

export async function getReferrals({ data }: Input<{ initData: string }>): Promise<Referrals> {
  return callBackend<Referrals>("/api/game/referrals", withInit.parse(data));
}

export async function claimReferral({ data }: Input<{ initData: string; friendId: number }>): Promise<ReferralClaim> {
  const input = z.object({ initData: init, friendId: z.number().int().positive() }).parse(data);
  const response = await runQueuedAction(input.initData, { type: "claim-referral", friendId: input.friendId });
  if (!response.result.ok) throw new Error(response.result.error ?? "Referral reward was rejected");
  if (response.result.data?.notEligible) return { ok: false, notEligible: true };
  return { ok: true, state: response.state };
}

export async function getWithdrawalStatus({ data }: Input<{ initData: string }>): Promise<Snapshot> {
  return callBackend<Snapshot>("/api/game/withdrawal-status", withInit.parse(data));
}

export async function requestWithdraw({ data }: Input<{ initData: string; milli: number; address: string }>): Promise<Snapshot> {
  const input = z.object({
    initData: init,
    milli: z.number().int().min(30).max(1_000_000),
    address: z.string().min(40).max(80),
  }).parse(data);
  return callBackend<Snapshot>("/api/game/withdraw", input);
}

export async function startAd({ data }: Input<{ initData: string; abandonSessionId?: string }>): Promise<{ sessionId: string; resumed: boolean }> {
  const input = z.object({
    initData: init,
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
