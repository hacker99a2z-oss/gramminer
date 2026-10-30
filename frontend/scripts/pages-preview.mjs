import { spawn } from "node:child_process";

function value(name, fallback) {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(name + "="));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const host = value("--host", "127.0.0.1");
const port = value("--port", "8788");
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, [
  "wrangler",
  "pages",
  "dev",
  "dist",
  "--ip",
  host,
  "--port",
  port,
], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error("Could not start the Cloudflare Pages preview:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
