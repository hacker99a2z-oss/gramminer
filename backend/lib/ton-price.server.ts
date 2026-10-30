const CACHE_MS = 60_000;
let cache: { value: number; expiresAt: number } | null = null;
let pending: Promise<number> | null = null;

async function fetchTonUsd(): Promise<number> {
  const primary = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd").catch(() => null);
  if (primary?.ok) {
    const payload = await primary.json() as { "the-open-network"?: { usd?: number } };
    const price = payload["the-open-network"]?.usd;
    if (price && price > 0) return price;
  }

  const fallback = await fetch("https://tonapi.io/v2/rates?tokens=ton&currencies=usd");
  if (!fallback.ok) throw new Error("Price unavailable, try again");
  const payload = await fallback.json() as { rates?: { TON?: { prices?: { USD?: number } } } };
  const price = payload.rates?.TON?.prices?.USD;
  if (!price || price <= 0) throw new Error("Price unavailable, try again");
  return price;
}

export async function getTonUsd(): Promise<number> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (!pending) {
    pending = fetchTonUsd().then((value) => {
      cache = { value, expiresAt: Date.now() + CACHE_MS };
      return value;
    }).finally(() => {
      pending = null;
    });
  }
  return pending;
}
