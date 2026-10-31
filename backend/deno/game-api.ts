import { createGameApiHandler } from "./game-api-handler.ts";

const port = Number(Deno.env.get("PORT") ?? "8000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

Deno.serve({ hostname: "0.0.0.0", port }, createGameApiHandler());
