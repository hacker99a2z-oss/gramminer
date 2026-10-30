// Browser-only access to the Telegram WebApp object.
type TgWebApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; username?: string; photo_url?: string } };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: {
    impactOccurred: (s: "light" | "medium" | "heavy") => void | Promise<void>;
    notificationOccurred: (t: "success" | "error") => void | Promise<void>;
  };
};

export function tgApp(): TgWebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
}

export const haptic = (t: "success" | "error" | "light" = "light") => {
  const h = tgApp()?.HapticFeedback;
  if (!h) return;

  // Haptic feedback is optional and is not supported by every Telegram client.
  // Ignore synchronous and asynchronous WebView middleware failures so they
  // never create an unhandled rejection or hide the original ad error.
  try {
    const result = t === "light" ? h.impactOccurred("light") : h.notificationOccurred(t);
    void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Unsupported haptic feedback must not affect the game flow.
  }
};
