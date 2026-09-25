/**
 * Snap mode (F2), headless: Chrome plays e2e/fixtures/pages.y4m as the camera (two notebook pages, "Roll 3" and
 * "Roll 7", each held steady ~3 s with a blurred page turn between them, looping).
 *
 * 1. a fresh class with two students who joined with roll numbers 3 and 7
 * 2. /teacher/<code>/snap: the camera opens, the readiness pill shows why it has or hasn't fired
 * 3. at least one page is captured by itself and filed by its roll number ("roll 3" or "roll 7" on the card)
 * 4. the timing readout appears
 * 5. a gallery photo whose roll number belongs to nobody lands in the Unassigned tray; one tap files it
 *
 * Needs the snap flag on in the app under test (NEXT_PUBLIC_FLAG_SNAP=1 for `next dev`/`next build`).
 * Build the fixture once: C:/dev/T28-Team-X/backend/.venv/Scripts/python e2e/fixtures/make-y4m.py
 */
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const Y4M = resolve(__dirname, "..", "fixtures", "pages.y4m");
const UNASSIGNED_PNG = resolve(__dirname, "..", "fixtures", "page-roll-42.png");

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${Y4M}`],
  },
});

test.describe.serial("snap mode", () => {
  let code = "";

  test.beforeAll(async ({ request }) => {
    if (!existsSync(Y4M)) {
      // the 32 MB fixture is never committed; build it with the backend's Python (it has Pillow)
      const { spawnSync } = await import("node:child_process");
      const py = process.env.PYTHON ?? resolve(__dirname, "..", "..", "backend", ".venv", "Scripts", "python.exe");
      const r = spawnSync(existsSync(py) ? py : "python", [resolve(__dirname, "..", "fixtures", "make-y4m.py")], { stdio: "inherit" });
      expect(r.status, "build the fake-camera fixture").toBe(0);
    }
    expect(existsSync(Y4M), `missing fixture ${Y4M}: run e2e/fixtures/make-y4m.py`).toBeTruthy();
    const created = await request.post("/backend/sessions/create", { data: { class_name: `Snap test ${Date.now() % 100000}` } });
    expect(created.ok(), "create a test class").toBeTruthy();
    code = ((await created.json()) as { code: string }).code;
    for (const [nickname, roll] of [
      ["Kavya", 3],
      ["Rohan", 7],
    ] as const) {
      const joined = await request.post("/backend/students/join", {
        data: { code, nickname, language: "en", roll_no: roll },
      });
      expect(joined.ok(), `${nickname} joins with roll ${roll}`).toBeTruthy();
    }
  });

  test("auto-captures a page from the fake camera, files it by roll number, and times it", async ({ page, context }) => {
    await context.grantPermissions(["camera"]);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });

    await page.goto(`/teacher/${code}/snap`);
    const stage = page.getByRole("region", { name: "Camera" });
    await expect(stage).toBeVisible();
    await expect(stage.getByRole("button", { name: "Take a photo of this page" })).toBeEnabled({ timeout: 30_000 });
    // the readiness indicator explains itself
    await expect(stage.getByRole("status")).toBeVisible({ timeout: 15_000 });
    await expect(stage.getByRole("status")).toHaveText(/Hold steady|Sharp|Got it|Same page|Too blurry|Point the camera/);

    // a page is captured without a tap and filed under roll 3 or roll 7
    const strip = page.getByRole("list", { name: "Snapped pages" });
    await expect(strip.getByRole("listitem").first()).toBeVisible({ timeout: 20_000 });
    const filedCard = strip.getByRole("listitem").filter({ hasText: /roll (3|7)\)/ });
    await expect(filedCard.first()).toBeVisible({ timeout: 90_000 });
    await expect(filedCard.first()).toContainText(/\d+ problems? · \d+ wrong/);

    // the result line and the live counter
    const filedList = page.getByRole("region", { name: "Filed pages" });
    await expect(filedList.getByText(/Snap · (Kavya|Rohan) \(roll (3|7)\) · \d+ problems? · \d+ wrong/).first()).toBeVisible();
    await expect(stage.getByText(/Pages [1-9]\d* · Problems \d+ · Wrong \d+/)).toBeVisible();

    // the timing readout (internal measurement)
    const timing = page.getByRole("region", { name: "Timing" });
    await expect(timing).toBeVisible();
    await expect(timing.getByRole("heading", { name: "Seconds per notebook" })).toBeVisible();
    await expect(timing.getByText(/\d+ pages? in \d+ s/)).toBeVisible();
    await expect(timing.getByRole("button", { name: "Copy timings" })).toBeVisible();

    // a gallery photo with a roll number nobody has goes to the tray; one tap files it under Kavya
    await page.getByLabel("Use photos from the gallery").setInputFiles(UNASSIGNED_PNG);
    const tray = page.getByRole("region", { name: "Unassigned pages" });
    await expect(tray).toBeVisible({ timeout: 90_000 });
    await expect(tray.getByText(/Roll 42 isn't on the class list/)).toBeVisible();
    await tray.getByRole("button", { name: /^3 · Kavya$/ }).click();
    await expect(tray).toBeHidden({ timeout: 30_000 });
    await expect(filedList.getByText(/Snap · Kavya \(roll 3\)/).first()).toBeVisible();

    expect(errors, "no console errors on the snap screen").toEqual([]);
  });
});
