export type MinerRule = {
  id: number;
  cost: number;
  minutes: number;
  rewardMilli: number;
};

/** rewardMilli is thousandths of a US dollar ($0.005 is 5). */
export const MINERS: MinerRule[] = [
  { id: 1, cost: 500, minutes: 5, rewardMilli: 5 },
  { id: 2, cost: 1100, minutes: 10, rewardMilli: 10 },
  { id: 3, cost: 2000, minutes: 15, rewardMilli: 20 },
  { id: 4, cost: 5000, minutes: 20, rewardMilli: 50 },
  { id: 5, cost: 10000, minutes: 30, rewardMilli: 100 },
];

export const DAILY_BONUS_COINS = 100;
export const AD_REWARD_COINS = 100;
export const AD_COOLDOWN_MS = 3 * 60 * 1000;
export const DONATE_COINS = 100;
export const REFERRAL_REWARD_COINS = 100;
export const REFERRAL_REQUIRED_MINER = 2;
export const MIN_WITHDRAW_MILLI = 30;
export const LEADERBOARD_SIZE = 20;
export const WITHDRAW_HISTORY_LIMIT = 20;
export const ADSGRAM_BLOCK_ID = "41655";

export const minerById = (id: number) => MINERS.find((miner) => miner.id === id);

export function minerReadyAt(startedAt: number, minerId: number) {
  const rule = minerById(minerId);
  return rule ? startedAt + rule.minutes * 60_000 : startedAt;
}

export const usd = (milli: number) => {
  const value = milli / 1000;
  return `$${value < 1 && milli % 10 !== 0 ? value.toFixed(3) : value.toFixed(2)}`;
};
