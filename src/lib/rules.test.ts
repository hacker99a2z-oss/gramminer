import { describe, expect, it } from "vitest";
import { AD_COOLDOWN_MS, AD_REWARD_COINS, DAILY_BONUS_COINS, MINERS, REFERRAL_REWARD_COINS, minerReadyAt, usd } from "./rules";

describe("Gram Miner rules", () => {
  it("miner prices, times and rewards match the spec", () => {
    expect(MINERS.map((m) => [m.cost, m.minutes, m.rewardMilli])).toEqual([
      [500, 5, 5],
      [1100, 10, 10],
      [2000, 15, 20],
      [5000, 20, 50],
      [10000, 30, 100],
    ]);
  });
  it("bonus, ad and referral give 100 coins; ad cooldown is 3 minutes", () => {
    expect(DAILY_BONUS_COINS).toBe(100);
    expect(AD_REWARD_COINS).toBe(100);
    expect(REFERRAL_REWARD_COINS).toBe(100);
    expect(AD_COOLDOWN_MS).toBe(180_000);
  });
  it("miner 5 is ready 30 minutes after start", () => {
    expect(minerReadyAt(0, 5)).toBe(30 * 60_000);
  });
  it("formats dollars", () => {
    expect(usd(5)).toBe("$0.005");
    expect(usd(100)).toBe("$0.10");
  });
});
