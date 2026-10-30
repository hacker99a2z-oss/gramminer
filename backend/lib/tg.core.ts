import { createHmac, timingSafeEqual } from "node:crypto";

export type TgUser = {
  id: number;
  first_name: string;
  username?: string;
  photo_url?: string;
  start_param?: string;
};

export async function verifyInitData(initData: string): Promise<TgUser> {
  if (!initData || initData.length > 4096) throw new Error("Open the app inside Telegram");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) throw new Error("Open the app inside Telegram");
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value).join("\n");
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("Telegram bot is not configured");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  const supplied = Buffer.from(receivedHash, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid login");
  }
  const authDate = Number(params.get("auth_date") ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > now + 60 || now - authDate > 7 * 86400) {
    throw new Error("Login expired, reopen the app");
  }
  let user: unknown;
  try { user = JSON.parse(params.get("user") ?? "{}"); } catch { throw new Error("Invalid login"); }
  if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "number") {
    throw new Error("Invalid login");
  }
  const parsed = user as { id: number; first_name?: string; username?: string; photo_url?: string };
  return {
    id: parsed.id,
    first_name: parsed.first_name ?? "Miner",
    username: parsed.username,
    photo_url: parsed.photo_url,
    start_param: params.get("start_param") ?? undefined,
  };
}

function getBotToken(): string {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("Telegram bot is not configured");
  return token;
}

let botCache: { id: number; username: string } | null = null;

export async function getBot(): Promise<{ id: number; username: string }> {
  if (botCache) return botCache;
  const response = await fetch("https://api.telegram.org/bot" + getBotToken() + "/getMe", {
    method: "POST",
    cache: "no-store",
  });
  const payload = await response.json() as {
    ok?: boolean;
    result?: { id?: number; username?: string };
  };
  if (!response.ok || !payload.ok || typeof payload.result?.id !== "number") {
    throw new Error("Telegram getMe failed");
  }
  botCache = { id: payload.result.id, username: payload.result.username ?? "" };
  return botCache;
}

export function proofChannelUrl(): string | null {
  const chat = process.env["PAYMENT_PROOF_CHAT_ID"];
  if (chat?.startsWith("@")) return "https://t.me/" + chat.slice(1);
  const url = process.env["PAYMENTS_PROOF_URL"];
  return url && /^https:\/\//.test(url) ? url : null;
}
