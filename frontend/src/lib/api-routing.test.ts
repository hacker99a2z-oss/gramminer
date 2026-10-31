import { describe, expect, it } from "vitest";
import { resolveApiBaseUrls } from "./api-routing";

describe("API service routing", () => {
  it("keeps every route on the existing backend when no overrides are configured", () => {
    expect(resolveApiBaseUrls({})).toEqual({
      game: "https://gramminer-backend.onrender.com",
      ads: "https://gramminer-backend.onrender.com",
      referral: "https://gramminer-backend.onrender.com",
      leaderboard: "https://gramminer-backend.onrender.com",
      finance: "https://gramminer-backend.onrender.com",
    });
  });

  it("uses the legacy backend URL as the fallback for unconfigured services", () => {
    expect(resolveApiBaseUrls({ VITE_BACKEND_URL: "https://worker.example.com/" })).toEqual({
      game: "https://worker.example.com",
      ads: "https://worker.example.com",
      referral: "https://worker.example.com",
      leaderboard: "https://worker.example.com",
      finance: "https://worker.example.com",
    });
  });

  it("overrides only the service with an explicitly configured origin", () => {
    expect(resolveApiBaseUrls({
      VITE_BACKEND_URL: "https://worker.example.com",
      VITE_ADS_API_URL: "https://ads.example.com/",
      VITE_LEADERBOARD_API_URL: " https://leaderboard.example.com/// ",
    })).toEqual({
      game: "https://worker.example.com",
      ads: "https://ads.example.com",
      referral: "https://worker.example.com",
      leaderboard: "https://leaderboard.example.com",
      finance: "https://worker.example.com",
    });
  });

  it("falls back when a service override is empty or whitespace", () => {
    expect(resolveApiBaseUrls({
      VITE_BACKEND_URL: "https://worker.example.com",
      VITE_GAME_API_URL: "   ",
    }).game).toBe("https://worker.example.com");
  });
});
