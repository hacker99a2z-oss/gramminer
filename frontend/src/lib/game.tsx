import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { loadGame } from "./game.functions";
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

export function GameProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [initData, setInitData] = useState<string | null>(null);
  const [user, setUser] = useState<GameUser>({ id: null, name: "Miner" });
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [botUsername, setBot] = useState<string | null>(null);
  const [proofUrl, setProof] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = tgApp()?.initData;
    if (!data) return;
    try {
      const r = await loadGame({ data: { initData: data } });
      setState(r.state);
      setBot(r.botUsername);
      setProof(r.proofUrl);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

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

  return (
    <GameCtx.Provider value={{ ready, initData, user, state, setState, error, botUsername, proofUrl, refresh }}>
      {children}
    </GameCtx.Provider>
  );
}

export function useGame() {
  const c = useContext(GameCtx);
  if (!c) throw new Error("useGame outside provider");
  return c;
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}
