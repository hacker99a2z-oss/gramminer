// Browser-only Tonkeeper (TON Connect) helper, loaded lazily so SSR never touches it.
import { useEffect, useState } from "react";
import type { TonConnectUI } from "@tonconnect/ui";

let instance: Promise<TonConnectUI> | null = null;

export function getWallet(): Promise<TonConnectUI> {
  if (!instance) {
    instance = import("@tonconnect/ui").then(
      ({ TonConnectUI }) => new TonConnectUI({ manifestUrl: `${window.location.origin}/tonconnect-manifest.json` }),
    );
  }
  return instance;
}

export function useWalletAddress() {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    let off: (() => void) | undefined;
    void getWallet().then((ui) => {
      setAddress(ui.account?.address ?? null);
      off = ui.onStatusChange((w) => setAddress(w?.account.address ?? null));
    });
    return () => off?.();
  }, []);
  return address;
}

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
