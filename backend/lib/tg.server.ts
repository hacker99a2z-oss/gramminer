// Direct Telegram Bot API integration. No external connector or Lovable credentials.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  clearTelegramCachedFileId,
  getTelegramCachedFileId,
  setTelegramCachedFileId,
} from "./db.server.ts";

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
  const secretKey = createHmac("sha256", "WebAppData").update(getBotToken()).digest();
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


// ---------- Telegram bot welcome flow ----------
function telegramHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function telegramWebhookSecret(): string {
  return createHmac("sha256", getBotToken()).update("gramminer-telegram-webhook-v1").digest("hex");
}

export function verifyTelegramWebhookSecret(value: string | string[] | undefined): boolean {
  const supplied = Buffer.from(typeof value === "string" ? value : "");
  const expected = Buffer.from(telegramWebhookSecret());
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function configureTelegramWebhook(): Promise<void> {
  const baseUrl = telegramHttpsUrl(process.env["PUBLIC_BACKEND_URL"]) ??
    "https://gramminer-backend.onrender.com";
  const url = new URL("/api/telegram/webhook", baseUrl).toString();
  await botApi<boolean>("setWebhook", {
    url,
    secret_token: telegramWebhookSecret(),
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
}

const WELCOME_VIDEO_URL =
  "https://raw.githubusercontent.com/hacker99a2z-oss/gramminer/main/backend/lib/assets/gramminer-welcome.mp4";

/**
 * Telegram can execute a Bot API method from the webhook HTTP response.
 * This avoids a separate outbound connection from Render to api.telegram.org.
 */
export function startWelcomeWebhookReply(chatId: number): Record<string, unknown> {
  const appUrl = telegramHttpsUrl(process.env["BOT_APP_URL"]) ??
    "https://play-for-win-himu6.vercel.app";
  const officialChannel = telegramHttpsUrl(process.env["BOT_OFFICIAL_CHANNEL_URL"]);
  const supportGroup = telegramHttpsUrl(process.env["BOT_SUPPORT_GROUP_URL"]);

  const caption = [
    "🎮 <b>Welcome to Gram Miner!</b>",
    "⛏️ <b>1. Mine</b> — Start miners and collect coins.",
    "🎁 <b>2. Earn</b> — Get bonus coins from ads and referrals.",
    "💎 <b>3. Withdraw</b> — Cash out to your TON wallet from $0.03.",
  ].join("\n\n");

  const inlineKeyboard: Array<Array<Record<string, unknown>>> = [
    [{ text: "🚀 Open App", web_app: { url: appUrl } }],
  ];
  if (officialChannel) inlineKeyboard.push([{ text: "📢 Official Channel", url: officialChannel }]);
  if (supportGroup) inlineKeyboard.push([{ text: "💬 Supported Group", url: supportGroup }]);

  return {
    method: "sendVideo",
    chat_id: chatId,
    video: WELCOME_VIDEO_URL,
    supports_streaming: true,
    caption,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard },
  };
}

const WELCOME_VIDEO_CACHE_KEY = "gramminer-welcome-video-v1";

async function sendWelcomeVideo(
  chatId: number,
  caption: string,
  replyMarkup: { inline_keyboard: Array<Array<Record<string, unknown>>> },
): Promise<void> {
  const messageOptions = {
    chat_id: chatId,
    supports_streaming: true,
    caption,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  };

  // Telegram file_ids are reusable by this bot. Reuse the cached id so
  // every /start after the first upload avoids sending the 14 MB video again.
  const cachedFileId = await getTelegramCachedFileId(WELCOME_VIDEO_CACHE_KEY);
  if (cachedFileId) {
    try {
      await botApi("sendVideo", { ...messageOptions, video: cachedFileId });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/wrong file identifier|file identifier|file reference|file_id/i.test(message)) {
        throw error;
      }
      console.warn("[telegram] cached welcome video file_id was rejected; uploading the video again");
      await clearTelegramCachedFileId(WELCOME_VIDEO_CACHE_KEY);
    }
  }

  let video: Buffer;
  try {
    // Prefer the raw MP4 asset so replacing the welcome video does not require Base64 conversion.
    video = await readFile(new URL("./assets/gramminer-welcome.mp4", import.meta.url));
  } catch {
    // Keep the bundled Base64 video as a fallback for older deployments.
    const encoded = await readFile(new URL("./assets/gramminer-welcome.mp4.b64", import.meta.url), "utf8");
    video = Buffer.from(encoded.trim(), "base64");
  }
  if (!video.length) throw new Error("Welcome video asset is empty");

  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("supports_streaming", "true");
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("reply_markup", JSON.stringify(replyMarkup));
  form.set("video", new Blob([new Uint8Array(video)], { type: "video/mp4" }), "gramminer-welcome.mp4");

  const response = await fetch(`https://api.telegram.org/bot${getBotToken()}/sendVideo`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const raw = await response.text();
  let payload: {
    ok?: boolean;
    description?: string;
    result?: { video?: { file_id?: string } };
  } = {};
  try {
    payload = raw ? JSON.parse(raw) as typeof payload : {};
  } catch {
    throw new Error("Telegram sendVideo returned an invalid response");
  }
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? `Telegram sendVideo failed (${response.status})`);
  }

  const fileId = payload.result?.video?.file_id;
  if (fileId) {
    // Do not fail delivery if only the optional cache write fails.
    await setTelegramCachedFileId(WELCOME_VIDEO_CACHE_KEY, fileId).catch((error) => {
      console.error("[telegram] could not cache welcome video file_id", error);
    });
  }
}

export async function sendStartWelcome(chatId: number): Promise<void> {
  const appUrl = telegramHttpsUrl(process.env["BOT_APP_URL"]) ??
    "https://gramminer-nine.vercel.app";
  const officialChannel = telegramHttpsUrl(process.env["BOT_OFFICIAL_CHANNEL_URL"]);
  const supportGroup = telegramHttpsUrl(process.env["BOT_SUPPORT_GROUP_URL"]);

  const caption = [
    "🎮 <b>Welcome to Gram Miner!</b>",
    "⛏️ <b>1. Mine</b> — Start miners and collect coins.",
    "🎁 <b>2. Earn</b> — Get bonus coins from ads and referrals.",
    "💎 <b>3. Withdraw</b> — Cash out to your TON wallet from $0.03.",
  ].join("\n\n");

  const inlineKeyboard: Array<Array<Record<string, unknown>>> = [
    [{ text: "🚀 Open App", web_app: { url: appUrl } }],
  ];
  if (officialChannel) inlineKeyboard.push([{ text: "📢 Official Channel", url: officialChannel }]);
  if (supportGroup) inlineKeyboard.push([{ text: "💬 Supported Group", url: supportGroup }]);

  const replyMarkup = { inline_keyboard: inlineKeyboard };
  try {
    // Telegram sends the caption and inline keyboard as part of the same video message.
    await sendWelcomeVideo(chatId, caption, replyMarkup);
  } catch (error) {
    console.error("[telegram] welcome video could not be sent; falling back to a text welcome", error);
    await botApi("sendMessage", {
      chat_id: chatId,
      text: caption,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }
}
