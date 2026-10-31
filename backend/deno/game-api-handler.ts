import { z } from "zod";
import * as game from "../lib/game.server.ts";
import { getDb } from "../lib/db.server.ts";

const initData = z.string().min(1).max(4096);
const withInit = z.object({ initData });
const minerInput = z.object({ initData, minerId: z.number().int().min(1).max(5) });

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
};

const MAX_BODY_BYTES = 16 * 1024;

function responseHeaders(request: Request, path: string): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
  });
  const origin = request.headers.get("Origin");
  if (origin) {
    const allowedOrigins = (
      Deno.env.get("FRONTEND_URLS") ?? Deno.env.get("FRONTEND_URL") ?? ""
    )
      .split(",")
      .map((value) => value.trim().replace(/\/+$/, ""))
      .filter(Boolean);

    if (allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "Origin");
    }
  }
  return headers;
}

function json(request: Request, path: string, status: number, value: unknown): Response {
  const headers = responseHeaders(request, path);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}

function text(request: Request, path: string, status: number, value: string): Response {
  const headers = responseHeaders(request, path);
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(value, { status, headers });
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
  return raw ? JSON.parse(raw) : {};
}

export function createGameApiHandler(): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(request, path) });
    }

    if ((request.method === "GET" || request.method === "HEAD") && path === "/health") {
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: responseHeaders(request, path) });
      }
      return json(request, path, 200, { ok: true, runtime: "deno-deploy", service: "game-api" });
    }

    if (request.method === "GET" && path === "/ready") {
      try {
        await getDb().execute("SELECT 1");
        return json(request, path, 200, { ok: true, database: "connected" });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown database error";
        console.error("[ready] Turso connection check failed:", reason);
        return json(request, path, 503, { ok: false, database: "unavailable" });
      }
    }

    const route = postRoutes[path];
    if (request.method === "POST" && route) {
      try {
        return json(request, path, 200, await route(await readJson(request)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Request failed";
        const unauthorized =
          /invalid login|login expired|open the app inside telegram|unauthorized/i.test(message);
        const badRequest =
          error instanceof z.ZodError ||
          error instanceof SyntaxError ||
          message === "Request body too large";
        return json(request, path, badRequest ? 400 : unauthorized ? 401 : 500, {
          error: message,
        });
      }
    }

    return text(request, path, 404, "Not found");
  };
}
