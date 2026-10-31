export async function proxyBackendGet(
  request: Request,
  backendUrl: string | undefined,
  path: string,
): Promise<Response> {
  const base = backendUrl?.replace(/\/+$/, "");
  if (!base) return new Response("Backend is not configured", { status: 503 });

  const incoming = new URL(request.url);
  const target = new URL(base + path);
  target.search = incoming.search;

  try {
    const forwardHeaders = new Headers({
      accept: request.headers.get("accept") ?? "*/*",
    });
    // The scheduled payout caller authenticates with a bearer token. Forward
    // it only through this fixed Pages -> Worker proxy path; never expose it
    // in browser JavaScript or append it to a URL.
    const authorization = request.headers.get("authorization");
    if (authorization) forwardHeaders.set("authorization", authorization);

    const upstream = await fetch(target, {
      method: "GET",
      headers: forwardHeaders,
      redirect: "manual",
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
