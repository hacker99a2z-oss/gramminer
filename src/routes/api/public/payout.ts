import { createFileRoute } from "@tanstack/react-router";

// Optional external cron: GET /api/public/payout?key=<PAYOUT_CRON_SECRET>
export const Route = createFileRoute("/api/public/payout")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env["PAYOUT_CRON_SECRET"];
        const key = new URL(request.url).searchParams.get("key");
        if (!secret || key !== secret) return new Response("ok");
        const { runPayouts } = await import("@/lib/payout.server");
        return Response.json(await runPayouts());
      },
    },
  },
});
