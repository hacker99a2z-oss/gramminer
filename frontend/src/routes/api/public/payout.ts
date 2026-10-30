import { createFileRoute } from "@tanstack/react-router";
import { proxyBackendGet } from "@/lib/backend-proxy.server";

export const Route = createFileRoute("/api/public/payout")({
  server: {
    handlers: {
      GET: async ({ request }) => proxyBackendGet(request, "/api/public/payout"),
    },
  },
});
