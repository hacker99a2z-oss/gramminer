import { defineConfig } from "nitro";

export default defineConfig({
  preset: "cloudflare-pages-static",
  commands: {
    preview: "node ./scripts/pages-preview.mjs",
  },
});
