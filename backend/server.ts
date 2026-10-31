import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setDefaultResultOrder } from "node:dns";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import * as game from "./lib/game.server.ts";
import { closeDatabase, getDb, verifyDatabaseConnection } from "./lib/db.server.ts";
import { runPayouts } from "./lib/payout.server.ts";
import { configureTelegramWebhook, startWelcomeWebhookReply, verifyTelegramWebhookSecret } from "./lib/tg.server.ts";

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
  "/api/game/sync": async (body) => {
    const data = z.object({ initData, actions: z.array(z.unknown()).min(1).max(20) }).parse(body);
    return game.syncActions(data.initData, data.actions);
  },
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

  if (path.startsWith("/api/public/")) {
    res.setHeader("access-control-allow-origin", "*");
  } else if (allowedOrigins.has(origin.replace(/\/+$/, ""))) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
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

  if (req.method === "POST" && url.pathname === "/api/telegram/webhook") {
    if (!verifyTelegramWebhookSecret(req.headers["x-telegram-bot-api-secret-token"])) {
      text(res, 403, "Forbidden");
      return;
    }
    const update = await readJson(req) as { message?: { text?: string; chat?: { id?: number } } };
    const message = update.message;
    const chatId = message?.chat?.id;
    const isStart = typeof chatId === "number" &&
      Number.isSafeInteger(chatId) &&
      typeof message?.text === "string" &&
      /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text);

    console.log(`[telegram] webhook update received; start=${isStart}`);
    // Telegram supports executing a Bot API method directly from the webhook response.
    // This avoids a separate outbound connection from Render to api.telegram.org.
    if (isStart) {
      json(res, 200, startWelcomeWebhookReply(chatId));
    } else {
      json(res, 200, { ok: true });
    }
    return;
  }

  // Lightweight uptime endpoint. It avoids touching the database or running payout
  // work, and supports both GET and HEAD methods used by monitoring services.
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
    if (req.method === "HEAD") {
      res.writeHead(200, { "cache-control": "no-store" });
      res.end();
    } else {
      json(res, 200, { ok: true });
    }
    return;
  }

  // Once the Cloudflare Worker is live, stop clients from bypassing the edge
  // and hitting the legacy Render game routes directly. Keep this switch off
  // until the Pages/Worker cutover has passed its smoke tests.
  if (
    process.env["EDGE_ONLY_API"] === "true" &&
    (url.pathname.startsWith("/api/game/") || url.pathname === "/api/public/adsgram/reward")
  ) {
    text(res, 403, "Use the Cloudflare API endpoint");
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
    try {
      const result = await game.rewardAd(Number(userId));
      // Keep an auditable result without logging the callback key or full Telegram ID.
      console.info(`[adsgram] server reward callback processed: ${result}`);
      const statuses: Record<string, number> = { ok: 200, already: 200, no_session: 404, expired: 410, cooldown: 429, not_started: 409 };
      text(res, statuses[result] ?? 400, result);
    } catch (error) {
      console.error("[adsgram] reward failed", error);
      text(res, 500, "Try again");
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/public/payout") {
    const secret = process.env["PAYOUT_CRON_SECRET"];
    // Prefer an Authorization header so scheduled workers do not put the
    // payout secret into URLs or access logs. Keep query-key support for
    // existing manual/cron callers during the transition.
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
    const key = bearer || url.searchParams.get("key") || "";
    const supplied = Buffer.from(key);
    const configured = Buffer.from(secret ?? "");
    if (!secret || supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      text(res, 403, "Forbidden");
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

// The Telegram webhook is persistent on Telegram's side; re-registering it on
// every Render restart is unnecessary and can spam ETIMEDOUT logs when outbound
// access to api.telegram.org is temporarily unavailable. Enable this flag only
// when intentionally changing the bot token, webhook URL, or secret.
const autoConfigureTelegramWebhook =
  process.env["TELEGRAM_AUTO_CONFIGURE_WEBHOOK"] === "true";

verifyDatabaseConnection()
  .then(() => {
    server.listen(port, "0.0.0.0", () => {
      console.log("Gram Miner backend connected to Turso and listening on port " + port);
      if (autoConfigureTelegramWebhook) {
        // Prefer IPv4 on hosts where IPv6 routes to Telegram may time out.
        setDefaultResultOrder("ipv4first");
        void configureTelegramWebhook()
          .then(() => console.log("Telegram /start webhook configured"))
          .catch((error) => {
            console.error(
              "[telegram] one-time webhook registration failed; the existing Telegram webhook is unchanged:",
              error,
            );
          });
      } else {
        console.log("[telegram] keeping the existing webhook; startup registration skipped");
      }
    });
  })
  .catch((error) => {
    console.error("Turso database connection check failed; refusing to start:", error);
    closeDatabase();
    process.exitCode = 1;
  });

process.once("SIGTERM", () => {
  server.close(() => closeDatabase());
});
process.once("SIGINT", () => {
  server.close(() => closeDatabase());
});
