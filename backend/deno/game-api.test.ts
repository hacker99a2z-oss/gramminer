import { createGameApiHandler } from "./game-api-handler.ts";

const handler = createGameApiHandler();

Deno.test("GET /health returns the Deno game API identity without database access", async () => {
  const response = await handler(new Request("https://game-api.test/health"));
  const body = await response.json();

  if (response.status !== 200 || body.ok !== true || body.runtime !== "deno-deploy" || body.service !== "game-api") {
    throw new Error("Unexpected health response");
  }
});

Deno.test("HEAD /health returns an empty 200 response", async () => {
  const response = await handler(new Request("https://game-api.test/health", { method: "HEAD" }));
  if (response.status !== 200 || (await response.text()) !== "") {
    throw new Error("Unexpected HEAD health response");
  }
});

Deno.test("unknown routes return 404", async () => {
  const response = await handler(new Request("https://game-api.test/unknown"));
  if (response.status !== 404) throw new Error("Expected 404 for unknown route");
});

Deno.test("routes not assigned to Deno remain unavailable", async () => {
  const paths = [
    "/api/game/referrals",
    "/api/game/claim-referral",
    "/api/game/start-ad",
    "/api/game/withdraw",
    "/api/game/leaderboard",
    "/api/public/adsgram/reward",
    "/api/public/payout",
  ];

  for (const path of paths) {
    const response = await handler(new Request("https://game-api.test" + path, { method: "POST" }));
    if (response.status !== 404) throw new Error(path + " should remain outside the Deno game API");
  }
});

Deno.test("OPTIONS responds without invoking a game route", async () => {
  const response = await handler(new Request("https://game-api.test/api/game/load", { method: "OPTIONS" }));
  if (response.status !== 204) throw new Error("Expected preflight 204");
});
