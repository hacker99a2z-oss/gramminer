import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import * as game from "./lib/game.server.ts";
import { runPayouts } from "./lib/payout.server.ts";
import { supabaseAdmin } from "./integrations/supabase/client.server.ts";

const initData = z.string().min(1).max(4096);
const withInit = z.object({ initData });
const minerInput = z.object({ initData, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });

const postRoutes: Record<string, (body: unknown) => Promise<unknown>> = {
  "/api/game/load": async (body) => {
    const data = withInit.parse(body);
    return game.load(data.initData);
  },
  "/api/game/claim-bonus": async (body) => {
    const data = withInit.parse(body);
    return game.rpc(data.initData, "gm_claim_bonus");
  },
  "/api/game/buy-miner": async (body) => {
    const data = minerInput.parse(body);
    return game.buyMiner(data.initData, data.minerId);
  },
  "/api/game/claim-miner": async (body) => {
    const data = minerInput.parse(body);
    return game.claimMiner(data.initData, data.minerId);
  },
  "/api/game/donate": async (body) => {
    const data = withInit.parse(body);
    return game.rpc(data.initData, "gm_donate");
  },
  "/api/game/referrals": async (body) => {
    const data = withInit.parse(body);
    return game.referrals(data.initData);
  },
  "/api/game/claim-referral": async (body) => {
    const data = z.object({ initData, friendId: z.number().int().positive() }).parse(body);
    return game.claimReferral(data.initData, data.friendId);
  },
  "/api/game/withdraw": async (body) => {
    const data = z.object({
      initData,
      milli: z.number().int().min(100).max(1_000_000),
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

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}

function text(res: ServerResponse, status: number, value: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(value);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 16 * 1024) throw new Error("Request body too large");
    chunks.push(part);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const allowedOrigins = new Set(
  (process.env["FRONTEND_URLS"] ?? process.env["FRONTEND_URL"] ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

function applyCors(req: IncomingMessage, res: ServerResponse, path: string) {
  const origin = req.headers.origin;
  if (!origin) return;

  // These callbacks are reached through the public Vercel URL and may also be
  // called by AdsGram/cron providers directly.
  if (path.startsWith("/api/public/")) {
    res.setHeader("access-control-allow-origin", "*");
  } else if (allowedOrigins.has(origin.replace(/\/+$/, ""))) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type");
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  applyCors(req, res, url.pathname);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/game/leaderboard") {
    json(res, 200, await game.leaderboard());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/public/adsgram/reward") {
    const expected = process.env["ADSGRAM_REWARD_SECRET"];
    if (!expected) {
      text(res, 503, "Reward verification is not configured");
      return;
    }
    const key = url.searchParams.get("key") ?? "";
    const supplied = Buffer.from(key);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      text(res, 403, "Invalid reward key");
      return;
    }
    const userId = url.searchParams.get("userid") ?? "";
    if (!/^\d{1,20}$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
      text(res, 400, "Invalid userid");
      return;
    }
    const { data, error } = await supabaseAdmin.rpc("gm_ad_reward", { _tg: Number(userId) });
    if (error) {
      console.error("[adsgram] reward failed", error);
      text(res, 500, "Try again");
      return;
    }
    const statuses: Record<string, number> = { ok: 200, already: 200, no_session: 404, expired: 410, cooldown: 429 };
    text(res, statuses[String(data)] ?? 400, String(data));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/public/payout") {
    const secret = process.env["PAYOUT_CRON_SECRET"];
    const key = url.searchParams.get("key");
    if (!secret || key !== secret) {
      text(res, 200, "ok");
      return;
    }
    json(res, 200, await runPayouts());
    return;
  }

  if (req.method === "POST" && postRoutes[url.pathname]) {
    try {
      const body = await readJson(req);
      const result = await postRoutes[url.pathname](body);
      json(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const unauthorized = /invalid login|login expired|open the app inside telegram|unauthorized/i.test(message);
      json(res, error instanceof z.ZodError ? 400 : unauthorized ? 401 : 500, { error: message });
    }
    return;
  }

  text(res, 404, "Not found");
}

const port = Number(process.env["PORT"] ?? 10000);
const server = createServer((req, res) => {
  void handle(req, res).catch((error) => {
    console.error("Backend request failed", error);
    if (!res.headersSent) json(res, 500, { error: "Internal server error" });
    else res.destroy();
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log("Gram Miner backend listening on port " + port);
});
