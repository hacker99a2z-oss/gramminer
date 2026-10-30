import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(command, ["run", "build"], {
  stdio: "inherit",
  env: { ...process.env, CLOUDFLARE_BUILD: "true" },
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("Could not start the Cloudflare build:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
