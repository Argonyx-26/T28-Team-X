import { defineConfig, devices } from "@playwright/test";

// BASE_URL: the web app under test (default: a local `next dev` on :3000, proxying to a local API).
// Uses the system Chrome locally; CI installs Playwright's Chromium instead.
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.E2E_VIDEO ? "on" : "off",
    ...(process.env.CI ? {} : { channel: "chrome" as const }),
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"] } }],
});
