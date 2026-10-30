import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getWithdrawalStatus, loadGame } from "./game.functions";
import { tgApp } from "./telegram";
import type { Snapshot } from "./game.types";

type GameUser = { id: number | null; name: string; username?: string | undefined; photoUrl?: string | undefined };
type Ctx = {
  ready: boolean;
  initData: string | null;
  user: GameUser;
  state: Snapshot | null;
  setState: (s: Snapshot) => void;
  error: string | null;
  botUsername: string | null;
  proofUrl: string | null;
  refresh: () => Promise<void>;
};

const GameCtx = createContext<Ctx | null>(null);
const GameClockCtx = createContext<number | null>(null);

function GameClockProvider({ children, serverOffset }: { children: ReactNode; serverOffset: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const syncClock = () => setNow(Date.now());
    const interval = window.setInterval(syncClock, 1000);
    document.addEventListener("visibilitychange", syncClock);
    window.addEventListener("focus", syncClock);
    window.addEventListener("pageshow", syncClock);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", syncClock);
      window.removeEventListener("focus", syncClock);
      window.removeEventListener("pageshow", syncClock);
    };
  }, []);

  return <GameClockCtx.Provider value={now + serverOffset}>{children}</GameClockCtx.Provider>;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [initData, setInitData] = useState<string | null>(null);
  const [user, setUser] = useState<GameUser>({ id: null, name: "Miner" });
  const [state, setState] = useState<Snapshot | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const updateState = useCallback((next: Snapshot) => {
    setState(next);
    setServerOffset(next.serverNow - Date.now());
  }, []);
  const [botUsername, setBot] = useState<string | null>(null);
  const [proofUrl, setProof] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = tgApp()?.initData;
    if (!data) return;
    try {
      const r = await loadGame({ data: { initData: data } });
      updateState(r.state);
      setBot(r.botUsername);
      setProof(r.proofUrl);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [updateState]);

  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const boot = () => {
      const app = tgApp();
      if (!app && tries++ < 30) {
        timer = setTimeout(boot, 100); // wait for the Telegram script to load
        return;
      }
      app?.ready();
      app?.expand();
      app?.setHeaderColor?.("#0d0c0a");
      app?.setBackgroundColor?.("#0d0c0a");
      const u = app?.initDataUnsafe.user;
      if (app?.initData && u) {
        setInitData(app.initData);
        setUser({ id: u.id, name: u.first_name, username: u.username, photoUrl: u.photo_url });
        void refresh().finally(() => setReady(true));
      } else {
        setError("Open Gram Miner inside Telegram to start mining.");
        setReady(true);
      }
    };
    boot();
    return () => clearTimeout(timer);
  }, [refresh]);

  const hasOpenWithdrawals = Boolean(
    state?.withdrawals.some((withdrawal) => withdrawal.status === "pending" || withdrawal.status === "sending"),
  );

  useEffect(() => {
    if (!initData || !hasOpenWithdrawals) return;

    let active = true;
    const poll = async () => {
      try {
        const latest = await getWithdrawalStatus({ data: { initData } });
        if (active) setState(latest);
      } catch (pollError) {
        console.error("Could not refresh withdrawal status", pollError);
      }
    };

    const timer = setInterval(() => void poll(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [hasOpenWithdrawals, initData]);

  return (
    <GameCtx.Provider value={{ ready, initData, user, state, setState: updateState, error, botUsername, proofUrl, refresh }}>
      <GameClockProvider serverOffset={serverOffset}>{children}</GameClockProvider>
    </GameCtx.Provider>
  );
}

export function useGameClock() {
  const now = useContext(GameClockCtx);
  if (now === null) throw new Error("useGameClock outside GameProvider");
  return now;
}

export function useGame() {
  const c = useContext(GameCtx);
  if (!c) throw new Error("useGame outside provider");
  return c;
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}
