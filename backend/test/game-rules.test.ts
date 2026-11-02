import assert from "node:assert/strict";
import test from "node:test";
import {
  AD_COOLDOWN_MS,
  DAILY_BONUS_COINS,
  MINERS,
  MIN_WITHDRAW_MILLI,
  minerReadyAt,
  usd,
} from "../../shared/game-rules.ts";

test("backend and frontend consume one canonical miner specification", () => {
  assert.deepEqual(MINERS.map((miner) => [miner.cost, miner.minutes, miner.rewardMilli]), [
    [500, 5, 5],
    [1100, 10, 10],
    [2000, 15, 20],
    [5000, 20, 50],
    [10000, 30, 100],
  ]);
  assert.equal(DAILY_BONUS_COINS, 100);
  assert.equal(AD_COOLDOWN_MS, 180_000);
  assert.equal(MIN_WITHDRAW_MILLI, 30);
  assert.equal(minerReadyAt(0, 5), 30 * 60_000);
  assert.equal(usd(5), "$0.005");
});
