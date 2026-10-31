export type ApiService = "game" | "ads" | "referral" | "leaderboard" | "finance";

export type ApiEnvironment = {
  VITE_BACKEND_URL?: string;
  VITE_GAME_API_URL?: string;
  VITE_ADS_API_URL?: string;
  VITE_REFERRAL_API_URL?: string;
  VITE_LEADERBOARD_API_URL?: string;
  VITE_FINANCE_API_URL?: string;
};

export type ApiBaseUrls = Record<ApiService, string>;

const DEFAULT_BACKEND_URL = "https://gramminer-backend.onrender.com";

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/+$/, "");
  return normalized || undefined;
}

/**
 * Resolve service-specific API origins while retaining the existing single-backend
 * deployment as the default. Each configured origin must implement the same
 * route paths and request/response contract used by the current API.
 */
export function resolveApiBaseUrls(env: ApiEnvironment): ApiBaseUrls {
  const fallback = normalizeBaseUrl(env.VITE_BACKEND_URL) ?? DEFAULT_BACKEND_URL;

  return {
    game: normalizeBaseUrl(env.VITE_GAME_API_URL) ?? fallback,
    ads: normalizeBaseUrl(env.VITE_ADS_API_URL) ?? fallback,
    referral: normalizeBaseUrl(env.VITE_REFERRAL_API_URL) ?? fallback,
    leaderboard: normalizeBaseUrl(env.VITE_LEADERBOARD_API_URL) ?? fallback,
    finance: normalizeBaseUrl(env.VITE_FINANCE_API_URL) ?? fallback,
  };
}
