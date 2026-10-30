// Keep the Lovable wrapper for its existing TanStack, Tailwind, aliases and
// diagnostics, but select the Vercel Nitro output when building on Vercel.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isVercel = !!process.env.VERCEL;

export default defineConfig({
  nitro: isVercel ? { preset: "vercel" } : true,
  tanstackStart: {
    // Preserve the existing SSR error wrapper.
    server: { entry: "server" },
  },
});
