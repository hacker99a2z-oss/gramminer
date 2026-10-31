import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tonconnect-manifest.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json(
          { url: origin, name: "Gram Miner", iconUrl: `${origin}/favicon.ico` },
          { headers: { "Access-Control-Allow-Origin": "*" } },
        );
      },
    },
  },
});
