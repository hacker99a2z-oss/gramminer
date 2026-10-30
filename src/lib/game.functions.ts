import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const init = z.string().min(1).max(4096);
const withInit = z.object({ initData: init });
const minerInput = z.object({ initData: init, minerId: z.number().int().min(1).max(5) });
const sessionInput = z.object({ initData: init, sessionId: z.string().regex(/^[a-f0-9]{32}$/) });

const S = () => import("./game.server");

export const loadGame = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => (await S()).load(data.initData));

export const claimBonus = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => (await S()).rpc(data.initData, "gm_claim_bonus"));

export const buyMiner = createServerFn({ method: "POST" })
  .inputValidator((d) => minerInput.parse(d))
  .handler(async ({ data }) => (await S()).buyMiner(data.initData, data.minerId));

export const claimMiner = createServerFn({ method: "POST" })
  .inputValidator((d) => minerInput.parse(d))
  .handler(async ({ data }) => (await S()).claimMiner(data.initData, data.minerId));

export const donate = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => (await S()).rpc(data.initData, "gm_donate"));

export const getLeaderboard = createServerFn({ method: "GET" }).handler(async () => (await S()).leaderboard());

export const getReferrals = createServerFn({ method: "POST" })
  .inputValidator((d) => withInit.parse(d))
  .handler(async ({ data }) => (await S()).referrals(data.initData));

export const claimReferral = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ initData: init, friendId: z.number().int().positive() }).parse(d))
  .handler(async ({ data }) => (await S()).claimReferral(data.initData, data.friendId));

export const requestWithdraw = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ initData: init, milli: z.number().int().min(100).max(1_000_000), address: z.string().min(40).max(80) }).parse(d))
  .handler(async ({ data }) => (await S()).withdraw(data.initData, data.milli, data.address));

export const startAd = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ initData: init, abandonSessionId: z.string().regex(/^[a-f0-9]{32}$/).optional() }).parse(d))
  .handler(async ({ data }) => (await S()).startAd(data.initData, data.abandonSessionId));

export const markAdStarted = createServerFn({ method: "POST" })
  .inputValidator((d) => sessionInput.parse(d))
  .handler(async ({ data }) => (await S()).adSessionUpdate(data.initData, data.sessionId, "started"));

export const cancelAd = createServerFn({ method: "POST" })
  .inputValidator((d) => sessionInput.parse(d))
  .handler(async ({ data }) => (await S()).adSessionUpdate(data.initData, data.sessionId, "cancel"));

export const adStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => sessionInput.parse(d))
  .handler(async ({ data }) => (await S()).adStatus(data.initData, data.sessionId));
