/**
 * The golden path: the judged demo, in demo order, on the app under test.
 *
 * 1. the landing page
 * 2. the scan screen: Asha's P1 sample → red circle on line 2, the arithmetic proof, the teacher confirms
 * 3. the dashboard: Asha's C4 cell is red
 * 4. "Plan tomorrow's lesson": the Analyst sends a plan back, the Coach revises, the Analyst accepts
 * 5. Approve, then the worksheet
 * 6. Asha on a 390 px phone: wrong answer → Fix this now → Kannada lesson → 2 retries → Gap closed → the meter moves
 *
 * It changes the demo class (Asha answers), so reset from /present afterwards on a live deployment.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CODE = "7B";
const SESSION_ID = "ses_7b";

type Bank = { questions: { id: string; stem: string; answer: string; kind: string }[] };
const bank: Bank = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "fractions.json"), "utf-8"));

function answerFor(stem: string): string {
  const q = bank.questions.find((x) => x.stem.trim() === stem.trim());
  if (!q) throw new Error(`no bank question with stem ${JSON.stringify(stem)}`);
  return q.answer;
}

async function gapsClosed(page: Page): Promise<number> {
  const r = await page.request.get(`/backend/teacher/dashboard?session_id=${SESSION_ID}`);
  expect(r.ok()).toBeTruthy();
  const d = (await r.json()) as { gaps: { closed: number } };
  return d.gaps.closed;
}

/** The presenter's admin token: PROD_ADMIN_TOKEN in the environment, or from backend/.env. Never printed. */
function adminTokenFromEnv(): string {
  if (process.env.PROD_ADMIN_TOKEN) return process.env.PROD_ADMIN_TOKEN;
  try {
    const env = readFileSync(join(__dirname, "..", "..", "backend", ".env"), "utf-8");
    const m = env.match(/^PROD_ADMIN_TOKEN=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

test.describe.serial("golden path", () => {
  test.beforeAll(async ({ request }) => {
    // the path assumes a fresh Asha (her first question is a C4 multiple-choice item, and her C4 cell starts amber)
    const token = process.env.E2E_NO_RESET ? "" : adminTokenFromEnv();
    if (!token) return;
    const r = await request.post("/backend/admin/reset", { headers: { "X-Admin-Token": token }, data: {} });
    expect(r.ok(), "reset the demo class before the golden path").toBeTruthy();
  });

  test("1. the landing page loads with the live numbers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("why");
    await expect(page.getByRole("link", { name: /Scan a notebook/ }).first()).toBeVisible();
    // the numbers come from the API; the skeleton must resolve
    await expect(page.getByText(/Wrong step circled correctly/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("2. the scan screen circles line 2 of Asha's page and the teacher confirms", async ({ page }) => {
    await page.goto(`/teacher/${CODE}/scan`);
    const sample = page.getByRole("button", { name: /Asha's page: 3\/4 \+ 1\/4/ });
    await expect(sample).toBeEnabled({ timeout: 30_000 });
    await sample.click();
    const diagnosis = page.getByRole("region", { name: "Diagnosis" });
    await expect(diagnosis).toBeVisible({ timeout: 60_000 });
    await expect(diagnosis.getByText("added the denominators too").first()).toBeVisible();
    await expect(diagnosis.getByText(/Line 2:/)).toBeVisible();
    // the red pen: an SVG ellipse inside the circled line
    await expect(diagnosis.locator("ol[aria-label] li svg path").first()).toBeVisible();
    await expect(diagnosis.getByText(/Checked by exact arithmetic|Answer checked/)).toBeVisible();
    await diagnosis.getByRole("button", { name: /Yes, that's the mistake/ }).click();
    await expect(diagnosis.getByText(/You confirmed it/)).toBeVisible();
  });

  test("3. the dashboard shows Asha's C4 cell red", async ({ page }) => {
    await page.goto(`/teacher/${CODE}`);
    const cell = page.getByRole("img", { name: /Asha, Adding and subtracting fractions:/ });
    await expect(cell).toBeVisible({ timeout: 30_000 });
    await expect(cell).toHaveAttribute("aria-label", /\(gap\)/);
  });

  test("4 + 5. the Analyst sends a plan back, the Coach revises, the teacher approves and prints", async ({ page }) => {
    await page.goto(`/teacher/${CODE}`);
    await page.getByRole("button", { name: /Plan tomorrow's lesson/ }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText(/Analyst sent plan \d back/).first()).toBeVisible({ timeout: 120_000 });
    await expect(panel.getByText(/Coach revised the plan/).first()).toBeVisible({ timeout: 120_000 });
    await expect(panel.getByText(/Analyst accepted plan/).first()).toBeVisible({ timeout: 120_000 });
    await expect(panel.getByRole("heading", { name: /Your plan for tomorrow/ })).toBeVisible({ timeout: 60_000 });
    const approve = panel.getByRole("button", { name: /Approve plan/ }).first();
    await approve.click();
    await expect(panel.getByText(/Approved for tomorrow/).first()).toBeVisible();
    const popup = page.waitForEvent("popup");
    await panel.getByRole("link", { name: /Print the group's worksheet/ }).first().click();
    const sheet = await popup;
    await expect(sheet.getByRole("heading", { name: /Practise/ })).toBeVisible({ timeout: 30_000 });
    await sheet.close();
  });

  test("6. Asha closes the gap on a 390 px phone and the class meter moves", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const before = await gapsClosed(page);

    await page.goto(`/join/${CODE}?as=asha`);
    const options = page.locator("button", { hasText: /\d+\/\d+/ });
    await expect(options.first()).toBeVisible({ timeout: 30_000 });
    // the question is on C4; "2/6" is the add-the-denominators distractor on both C4 multiple-choice items
    const wrong = options.filter({ hasText: "2/6" });
    await ((await wrong.count()) ? wrong.first() : options.last()).click();
    await expect(page.getByText("ಸ್ವಲ್ಪ ತಪ್ಪಾಗಿದೆ")).toBeVisible();
    await page.getByRole("button", { name: "ಈಗಲೇ ಸರಿಪಡಿಸಿ" }).click();
    await expect(page.getByRole("heading", { name: "ನಿಮ್ಮ ಕಿರು ಪಾಠ" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("ಕನ್ನಡ", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /ಇನ್ನೂ 2 ಪ್ರಶ್ನೆ/ }).click();

    const items = page.locator("section > div", { has: page.locator("p") }).filter({ hasText: /^\d\. / });
    await expect(items).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const item = items.nth(i);
      const stem = (await item.locator("p").first().innerText()).replace(/^\d\.\s*/, "");
      const answer = answerFor(stem);
      const option = item.getByRole("button", { name: answer, exact: true });
      if (await option.count()) await option.click();
      else await item.getByRole("textbox").first().fill(answer);
    }
    await page.getByRole("button", { name: "ಎರಡನ್ನೂ ಪರಿಶೀಲಿಸಿ" }).click();
    await expect(page.getByText("ಕೊರತೆ ನೀಗಿದೆ!")).toBeVisible({ timeout: 30_000 });

    const after = await gapsClosed(page);
    expect(after).toBe(before + 1);
    await context.close();
  });
});
