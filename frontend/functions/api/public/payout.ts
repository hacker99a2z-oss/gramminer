import { proxyBackendGet } from "../../_utils/proxy";

interface Env {
  BACKEND_URL: string;
}

export const onRequest = ({ request, env }: { request: Request; env: Env }) =>
  proxyBackendGet(request, env.BACKEND_URL, "/api/public/payout");
