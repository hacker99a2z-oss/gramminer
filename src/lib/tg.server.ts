// Telegram helpers (server only): initData verification + Bot API via the connector gateway.
const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
// Telegram's production public key for third-party initData validation (Ed25519).
const TG_PUBLIC_KEY_HEX = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";

export type TgUser = { id: number; first_name: string; username?: string | undefined; photo_url?: string | undefined; start_param?: string | undefined };

export async function botApi<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const tgKey = process.env["TELEGRAM_API_KEY"];
  if (!lovableKey || !tgKey) throw new Error("Telegram bot is not configured");
  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": tgKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Telegram ${method} failed [${res.status}]: ${text}`);
    throw new Error(`Telegram request failed [${res.status}]`);
  }
  const json = JSON.parse(text) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(json.description ?? "Telegram error");
  return json.result;
}

let botCache: { id: number; username: string } | null = null;
export async function getBot() {
  if (!botCache) {
    const me = await botApi<{ id: number; username: string }>("getMe");
    botCache = { id: me.id, username: me.username };
  }
  return botCache;
}

const hexToBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
function b64urlToBytes(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Verifies Mini App initData with Telegram's Ed25519 signature (no raw bot token needed). */
export async function verifyInitData(initData: string): Promise<TgUser> {
  if (typeof initData !== "string" || !initData || initData.length > 4096) throw new Error("Open the app inside Telegram");
  const params = new URLSearchParams(initData);
  const signature = params.get("signature");
  if (!signature) throw new Error("Open the app inside Telegram");
  params.delete("hash");
  params.delete("signature");
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const bot = await getBot();
  const data = new TextEncoder().encode(`${bot.id}:WebAppData\n${pairs}`);
  const key = await crypto.subtle.importKey("raw", hexToBytes(TG_PUBLIC_KEY_HEX), { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64urlToBytes(signature), data);
  if (!ok) throw new Error("Invalid login");
  const authDate = Number(params.get("auth_date") ?? 0);
  if (Date.now() / 1000 - authDate > 7 * 86400) throw new Error("Login expired, reopen the app");
  const user = JSON.parse(params.get("user") ?? "{}");
  if (typeof user.id !== "number") throw new Error("Invalid login");
  return {
    id: user.id,
    first_name: user.first_name ?? "Miner",
    username: user.username,
    photo_url: user.photo_url,
    start_param: params.get("start_param") ?? undefined,
  };
}

export function proofChannelUrl(): string | null {
  const chat = process.env["PAYMENT_PROOF_CHAT_ID"];
  if (chat?.startsWith("@")) return `https://t.me/${chat.slice(1)}`;
  const url = process.env["PAYMENTS_PROOF_URL"];
  return url && /^https:\/\//.test(url) ? url : null;
}
