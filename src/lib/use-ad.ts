// Rewarded AdsGram ad with server-side verification + shared 3-minute cooldown (ported from the original app).
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adStatus, cancelAd, markAdStarted, startAd } from "./game.functions";
import { ADSGRAM_BLOCK_ID } from "./rules";
import { useGame } from "./game";

type ShowResult = { done: boolean; description: string; state: string; error: boolean };
type AdController = {
  show: () => Promise<ShowResult>;
  addEventListener?: (e: "onStart", cb: () => void) => void;
  removeEventListener?: (e: "onStart", cb: () => void) => void;
  destroy?: () => void;
};

const FAILED_KEY = "gm:adsgram:failed:";

function showWithTimeout(c: AdController, onStart: () => void, ms = 30000) {
  if (!c.addEventListener || !c.removeEventListener) return c.show();
  let started = false;
  let t: ReturnType<typeof setTimeout> | undefined;
  const handle = () => { started = true; if (t) clearTimeout(t); onStart(); };
  c.addEventListener("onStart", handle);
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => { if (started) return; try { c.destroy?.(); } catch { /* */ } rej({ description: "Ad loading timed out", state: "load" }); }, ms);
  });
  return Promise.race([c.show(), timeout]).finally(() => { if (t) clearTimeout(t); c.removeEventListener?.("onStart", handle); });
}

function playbackError(e: unknown) {
  const r = e as { description?: string; state?: string } | undefined;
  if (r?.description === "banner not found" || r?.state === "load") return "No ad is available right now. Please try again shortly.";
  if (r?.description) return `The ad could not be completed: ${r.description}`;
  return e instanceof Error ? e.message : "Ad playback failed. Please try again.";
}

export function useRewardedAd() {
  const game = useGame();
  const start = useServerFn(startAd);
  const started = useServerFn(markAdStarted);
  const cancel = useServerFn(cancelAd);
  const status = useServerFn(adStatus);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ctrl = useRef<AdController | undefined>(undefined);
  const offset = useMemo(() => (game.state?.serverNow ? game.state.serverNow - Date.now() : 0), [game.state?.serverNow]);
  const nextAdAt = game.state?.nextAdAt ?? null;
  const left = nextAdAt ? Math.max(0, nextAdAt - (now + offset)) : 0;

  useEffect(() => {
    const sdk = (window as unknown as { Adsgram?: { init: (o: { blockId: string; debug?: boolean }) => AdController } }).Adsgram;
    if (sdk) ctrl.current = sdk.init({ blockId: ADSGRAM_BLOCK_ID, debug: false });
  }, []);

  useEffect(() => {
    if (!left) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);

  const secs = Math.ceil(left / 1000);
  const timer = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  const play = async () => {
    if (loading || left) return;
    const initData = game.initData;
    if (!initData || !game.user.id) throw new Error("Open the app inside Telegram");
    if (!ctrl.current) throw new Error("Ads are not available right now");
    setLoading(true);
    const key = FAILED_KEY + game.user.id;
    try {
      const failed = localStorage.getItem(key) ?? undefined;
      const s = await start({ data: { initData, abandonSessionId: failed && /^[a-f0-9]{32}$/.test(failed) ? failed : undefined } });
      if (failed) localStorage.removeItem(key);
      if (!s.resumed) {
        try {
          const r = await showWithTimeout(ctrl.current, () => void started({ data: { initData, sessionId: s.sessionId } }).catch(() => undefined));
          if (!r.done) throw new Error("Watch the ad till the end to get 100 coins");
        } catch (e) {
          localStorage.setItem(key, s.sessionId);
          try { await cancel({ data: { initData, sessionId: s.sessionId } }); localStorage.removeItem(key); } catch { /* retry next time */ }
          throw new Error(playbackError(e));
        }
      }
      for (let i = 0; i < 45; i++) {
        const st = await status({ data: { initData, sessionId: s.sessionId } });
        if (st.verified && st.state) {
          game.setState(st.state);
          setNow(Date.now());
          return;
        }
        if (st.expired) throw new Error("Ad verification expired. Please try again.");
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("Still waiting for ad confirmation. Tap Watch Ad again to check.");
    } finally {
      setLoading(false);
    }
  };

  return { loading, left, timer, play };
}
