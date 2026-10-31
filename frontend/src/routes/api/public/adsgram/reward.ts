import { createFileRoute } from "@tanstack/react-router";
import { proxyBackendGet } from "@/lib/backend-proxy.server";

export const Route = createFileRoute("/api/public/adsgram/reward")({
  server: {
    handlers: {
      GET: async ({ request }) => proxyBackendGet(request, "/api/public/adsgram/reward"),
    },
  },
});
