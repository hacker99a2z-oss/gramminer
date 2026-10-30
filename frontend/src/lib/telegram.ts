// Browser-only access to the Telegram WebApp object.
type TgWebApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; username?: string; photo_url?: string } };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: { impactOccurred: (s: "light" | "medium" | "heavy") => void; notificationOccurred: (t: "success" | "error") => void };
};

export function tgApp(): TgWebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
}

export const haptic = (t: "success" | "error" | "light" = "light") => {
  const h = tgApp()?.HapticFeedback;
  if (!h) return;
  if (t === "light") h.impactOccurred("light");
  else h.notificationOccurred(t);
};
