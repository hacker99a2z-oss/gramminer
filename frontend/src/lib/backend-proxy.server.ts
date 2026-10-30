// Server-only proxy for public callbacks routed through the Cloudflare Workers frontend.
export async function proxyBackendGet(request: Request, path: string): Promise<Response> {
  const backendUrl = process.env["BACKEND_URL"]?.replace(/\/+$/, "");
  if (!backendUrl) {
    return new Response("Backend is not configured", { status: 503 });
  }

  const incoming = new URL(request.url);
  const target = new URL(backendUrl + path);
  target.search = incoming.search;

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      cache: "no-store",
    });
    const headers = new Headers();
    for (const name of ["content-type", "cache-control", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return new Response("Backend service unavailable", { status: 502 });
  }
}
