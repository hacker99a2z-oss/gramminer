import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import * as game from "./lib/game.server.ts";
import { getDb } from "./lib/db.server.ts";

const initData = z.string().min(1).max(4096);
const withInit = z.object({ initData });
const minerInput = z.object({ initData, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });

const postRoutes: Record<string, (body: unknown) => Promise<unknown>> = {
  "/api/game/load": async (body) => game.load(withInit.parse(body).initData),
  "/api/game/claim-bonus": async (body) => game.claimBonus(withInit.parse(body).initData),
  "/api/game/buy-miner": async (body) => {
    const data = minerInput.parse(body);
    return game.buyMiner(data.initData, data.minerId);
  },
  "/api/game/claim-miner": async (body) => {
    const data = minerInput.parse(body);
    return game.claimMiner(data.initData, data.minerId);
  },
  "/api/game/donate": async (body) => game.donate(withInit.parse(body).initData),
  "/api/game/referrals": async (body) => game.referrals(withInit.parse(body).initData),
  "/api/game/claim-referral": async (body) => {
    const data = z.object({ initData, friendId: z.number().int().positive() }).parse(body);
    return game.claimReferral(data.initData, data.friendId);
  },
  "/api/game/withdrawal-status": async (body) => game.withdrawalStatus(withInit.parse(body).initData),
  "/api/game/withdraw": async (body) => {
    const data = z.object({
      initData,
      milli: z.number().int().min(30).max(1_000_000),
      address: z.string().min(40).max(80),
    }).parse(body);
    return game.withdraw(data.initData, data.milli, data.address);
  },
  "/api/game/start-ad": async (body) => {
    const data = z.object({
      initData,
      abandonSessionId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    }).parse(body);
    return game.startAd(data.initData, data.abandonSessionId);
  },
  "/api/game/mark-ad-started": async (body) => {
    const data = sessionInput.parse(body);
    return game.adSessionUpdate(data.initData, data.sessionId, "started");
  },
  "/api/game/cancel-ad": async (body) => {
    const data = sessionInput.parse(body);
    return game.adSessionUpdate(data.initData, data.sessionId, "cancel");
  },
  "/api/game/ad-status": async (body) => {
    const data = sessionInput.parse(body);
    return game.adStatus(data.initData, data.sessionId);
  },
};

function headers(request: Request, path: string): Headers {
  const result = new Headers({
    "cache-control": "no-store",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
  });
  const origin = request.headers.get("Origin");
  if (origin) {
    if (path.startsWith("/api/public/")) {
      result.set("access-control-allow-origin", "*");
    } else {
      const allowed = (process.env["FRONTEND_URLS"] ?? process.env["FRONTEND_URL"] ?? "")
        .split(",").map((item) => item.trim().replace(/\/+$/, "")).filter(Boolean);
      if (allowed.includes(origin.replace(/\/+$/, ""))) {
        result.set("access-control-allow-origin", origin);
        result.set("vary", "Origin");
      }
    }
  }
  return result;
}

function json(request: Request, path: string, status: number, value: unknown): Response {
  const responseHeaders = headers(request, path);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function text(request: Request, path: string, status: number, value: string): Response {
  const responseHeaders = headers(request, path);
  responseHeaders.set("content-type", "text/plain; charset=utf-8");
  return new Response(value, { status, headers: responseHeaders });
}

async function readJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16 * 1024) throw new Error("Request body too large");
  return raw ? JSON.parse(raw) : {};
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(request, path) });
  }

  if ((request.method === "GET" || request.method === "HEAD") && path === "/health") {
    if (request.method === "HEAD") return new Response(null, { status: 200 });
    return json(request, path, 200, { ok: true, runtime: "cloudflare-workers" });
  }

  if (request.method === "GET" && path === "/ready") {
    try {
      await getDb().execute("SELECT 1");
      return json(request, path, 200, { ok: true, database: "connected" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown database error";
      console.error("[ready] Turso check failed:", reason);
      return json(request, path, 503, { ok: false, database: "unavailable" });
    }
  }

  if (request.method === "GET" && path === "/api/game/leaderboard") {
    return json(request, path, 200, await game.leaderboard());
  }

  if (request.method === "GET" && path === "/api/public/adsgram/reward") {
    const expected = process.env["ADSGRAM_REWARD_SECRET"];
    if (!expected) return text(request, path, 503, "Reward verification is not configured");
    const supplied = Buffer.from(url.searchParams.get("key") ?? "");
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      return text(request, path, 403, "Invalid reward key");
    }
    const userId = url.searchParams.get("userid") ?? "";
    if (!/^\d{1,20}$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
      return text(request, path, 400, "Invalid userid");
    }
    try {
      const result = await game.rewardAd(Number(userId));
      const codes: Record<string, number> = {
        ok: 200, already: 200, no_session: 404, expired: 410, cooldown: 429, not_started: 409,
      };
      return text(request, path, codes[result] ?? 400, result);
    } catch (error) {
      console.error("[adsgram] reward failed", error);
      return text(request, path, 500, "Try again");
    }
  }

  if (request.method === "GET" && path === "/api/public/payout") {
    return json(request, path, 503, {
      error: "Payout processing remains on the existing Node service.",
    });
  }

  if (request.method === "POST" && postRoutes[path]) {
    try {
      const result = await postRoutes[path](await readJson(request));
      return json(request, path, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const unauthorized = /invalid login|login expired|open the app inside telegram|unauthorized/i.test(message);
      return json(request, path, error instanceof z.ZodError ? 400 : unauthorized ? 401 : 500, {
        error: message,
      });
    }
  }

  return text(request, path, 404, "Not found");
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handle(request);
    } catch (error) {
      console.error("Gram Miner Worker request failed", error);
      const path = new URL(request.url).pathname;
      return json(request, path, 500, { error: "Internal server error" });
    }
  },
};
