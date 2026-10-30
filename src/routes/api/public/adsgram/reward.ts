import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// AdsGram Reward URL: https://<app>/api/public/adsgram/reward?userid=[userId]&key=<ADSGRAM_REWARD_SECRET>
export const Route = createFileRoute("/api/public/adsgram/reward")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const expected = process.env["ADSGRAM_REWARD_SECRET"];
        if (!expected) return new Response("Reward verification is not configured", { status: 503 });
        const key = url.searchParams.get("key") ?? "";
        const a = Buffer.from(key);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Invalid reward key", { status: 403 });
        const userId = url.searchParams.get("userid") ?? "";
        if (!/^\d{1,20}$/.test(userId) || !Number.isSafeInteger(Number(userId))) return new Response("Invalid userid", { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("gm_ad_reward", { _tg: Number(userId) });
        if (error) {
          console.error("[adsgram] reward failed", error);
          return new Response("Try again", { status: 500 });
        }
        const map: Record<string, number> = { ok: 200, already: 200, no_session: 404, expired: 410, cooldown: 429 };
        return new Response(String(data), { status: map[String(data)] ?? 400 });
      },
    },
  },
});
