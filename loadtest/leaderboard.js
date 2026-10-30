import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "").replace(/\\/+$/, "");
if (!baseUrl) {
  throw new Error("Set BASE_URL to your staging Cloud Run URL.");
}
if (__ENV.CONFIRM_STAGING !== "yes") {
  throw new Error("Refusing to run without CONFIRM_STAGING=yes. Use a staging service and staging database only.");
}

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "60s", target: 25 },
    { duration: "60s", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
  },
};

export default function () {
  const response = http.get(baseUrl + "/api/game/leaderboard", {
    headers: { Accept: "application/json" },
    tags: { endpoint: "leaderboard_readonly" },
  });

  check(response, {
    "leaderboard responds with HTTP 200": (res) => res.status === 200,
    "leaderboard returns JSON": (res) =>
      (res.headers["Content-Type"] || "").includes("application/json"),
  });

  sleep(1);
}
