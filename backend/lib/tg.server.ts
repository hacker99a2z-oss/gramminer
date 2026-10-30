// Direct Telegram Bot API integration. No external connector or Lovable credentials.
import { createHmac, timingSafeEqual } from "node:crypto";

export type TgUser = {
  id: number;
  first_name: string;
  username?: string | undefined;
  photo_url?: string | undefined;
  start_param?: string | undefined;
};

function getBotToken(): string {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("Telegram bot is not configured. Set TELEGRAM_BOT_TOKEN in Render.");
  return token;
}

export async function botApi<T = unknown>(
  method: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const token = getBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const raw = await response.text();
  let payload: { ok?: boolean; result?: T; description?: string } = {};
  try {
    payload = raw ? JSON.parse(raw) as typeof payload : {};
  } catch {
    throw new Error(`Telegram ${method} returned an invalid response (${response.status})`);
  }

  if (!response.ok || !payload.ok) {
    const message = payload.description || `Telegram ${method} failed (${response.status})`;
    console.error(`[Telegram] ${message}`);
    throw new Error(message);
  }
  return payload.result as T;
}

let botCache: { id: number; username: string } | null = null;
export async function getBot() {
  if (!botCache) {
    const me = await botApi<{ id: number; username?: string }>("getMe");
    if (typeof me.id !== "number") throw new Error("Telegram getMe returned an invalid bot");
    botCache = { id: me.id, username: me.username ?? "" };
  }
  return botCache;
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/** Verify Telegram Mini App initData with the official bot-token HMAC-SHA-256 method. */
export async function verifyInitData(initData: string): Promise<TgUser> {
  if (typeof initData !== "string" || !initData || initData.length > 4096) {
    throw new Error("Open the app inside Telegram");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) {
    throw new Error("Open the app inside Telegram");
  }

  params.delete("hash");
  const checkString = dataCheckString(params);
  const secretKey = createHmac("sha256", getBotToken()).update("WebAppData").digest();
  const expectedHash = createHmac("sha256", secretKey).update(checkString).digest();
  const suppliedHash = Buffer.from(receivedHash, "hex");

  if (
    suppliedHash.length !== expectedHash.length ||
    !timingSafeEqual(suppliedHash, expectedHash)
  ) {
    throw new Error("Invalid login");
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > now + 60) {
    throw new Error("Invalid login");
  }
  if (now - authDate > 7 * 86400) {
    throw new Error("Login expired, reopen the app");
  }

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(params.get("user") ?? "{}");
  } catch {
    throw new Error("Invalid login");
  }
  if (
    parsedUser == null ||
    typeof parsedUser !== "object" ||
    !("id" in parsedUser) ||
    typeof parsedUser.id !== "number"
  ) {
    throw new Error("Invalid login");
  }

  const user = parsedUser as {
    id: number;
    first_name?: string;
    username?: string;
    photo_url?: string;
  };

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
