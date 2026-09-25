/**
 * F3 homework check on a 390 px phone: the child photographs their own page, the red pen circles the wrong step,
 * the mistake is named in Kannada, and "Fix this now" runs the existing lesson → 2 retries → gap closed flow.
 *
 * The entry point sits behind FLAGS.HOMEWORK (frontend/lib/flags.ts). Until the default is flipped, the test turns
 * the flag on in the browser only, by rewriting the served JS (see `flagsOn`); after the flip that is a no-op.
 * It needs an API with vision (the live API, or a local one with Vertex configured) and makes its own class, so it
 * never touches 7B.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** FLAGS.HOMEWORK and FLAGS.LISTEN on, in this browser only: the served chunk's `flag("NAME", false)` becomes true. */
export async function flagsOn(page: Page, names = ["HOMEWORK", "LISTEN"]) {
  await page.route("**/_next/static/**/*.js", async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    for (const name of names) {
      body = body.replace(new RegExp(`flag\\("${name}",\\s*(false|!1)\\)`, "g"), `flag("${name}", true)`);
    }
    await route.fulfill({ response: res, body, headers: { ...res.headers(), "content-length": String(Buffer.byteLength(body)) } });
  });
}

type Bank = { questions: { id: string; stem: string; answer: string; kind: string }[] };
const bank: Bank = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "fractions.json"), "utf-8"));

function answerFor(stem: string): string {
  const q = bank.questions.find((x) => x.stem.trim() === stem.trim());
  if (!q) throw new Error(`no bank question with stem ${JSON.stringify(stem)}`);
  return q.answer;
}

/** A page like a child's notebook: "Roll 7", then 2/5 + 1/3 with the denominators added on line 2. */
const drawPage = () => {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 1600;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fcf8e8";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#cdd7eb";
  g.lineWidth = 2;
  for (let y = 140; y < c.height; y += 96) {
    g.beginPath();
    g.moveTo(60, y);
    g.lineTo(c.width - 60, y);
    g.stroke();
  }
  g.strokeStyle = "#f0b4af";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(160, 0);
  g.lineTo(160, c.height);
  g.stroke();
  g.fillStyle = "#1e286e";
  g.font = "bold 60px 'Segoe Print', 'Comic Sans MS', sans-serif";
  g.fillText("Roll 7", 200, 110);
  g.font = "bold 84px 'Segoe Print', 'Comic Sans MS', sans-serif";
  const lines = ["2/5 + 1/3", "= (2+1)/(5+3)", "= 3/8"];
  lines.forEach((line, i) => g.fillText(line, 220, 320 + i * 192));
  return c.toDataURL("image/png");
};

test.describe.serial("F3 homework check", () => {
  let code = "";
  let labelKn = "";

  test.beforeAll(async ({ request }) => {
    const r = await request.post("/backend/sessions/create", { data: { class_name: "F3 test" } });
    expect(r.ok(), "create a class of our own").toBeTruthy();
    code = ((await r.json()) as { code: string }).code;
    const t = await request.get("/backend/topic");
    expect(t.ok()).toBeTruthy();
    const topic = (await t.json()) as { tags: { tag: string; labels: Record<string, string> }[] };
    labelKn = topic.tags.find((x) => x.tag === "add_denominators")?.labels.kn ?? "";
    expect(labelKn, "the Kannada label for add_denominators").not.toBe("");
  });

  test("Ravi checks a page, sees the red circle in Kannada, then closes the gap", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await flagsOn(page);

    await page.goto(`/join/${code}`);
    await page.getByRole("textbox").first().fill("Ravi");
    await page.getByRole("button", { name: "ಕನ್ನಡ" }).click();
    await page.getByRole("button", { name: "ಪ್ರಾರಂಭಿಸಿ" }).click();

    // the question screen: the camera button in the header is the entry point
    const camera = page.getByRole("button", { name: "ನನ್ನ ಹೋಮ್‌ವರ್ಕ್ ಪರಿಶೀಲಿಸಿ" });
    await expect(camera, "the homework entry point (FLAGS.HOMEWORK)").toBeVisible({ timeout: 30_000 });

    const dataUrl = await page.evaluate(drawPage);
    const png = Buffer.from(dataUrl.split(",")[1], "base64");
    const chooser = page.waitForEvent("filechooser");
    await camera.click();
    await (await chooser).setFiles({ name: "page.png", mimeType: "image/png", buffer: png });

    // reading: the preview with the sweep, then the result
    await expect(page.getByRole("status").filter({ hasText: "ನಿಮ್ಮ ಪುಟ ಓದುತ್ತಿದ್ದೇನೆ" })).toBeVisible();
    const result = page.getByRole("region", { name: "ನನ್ನ ಹೋಮ್‌ವರ್ಕ್ ಪರಿಶೀಲಿಸಿ" });
    await expect(result.getByRole("status").filter({ hasText: /ಸರಿಪಡಿಸಬೇಕು/ })).toBeVisible({ timeout: 90_000 });
    // the red pen around one line, and the mistake named in Kannada in the margin
    await expect(result.locator("article ol li svg path").first()).toBeVisible();
    await expect(result.getByText(labelKn).first()).toBeVisible();
    // the ledger: the exact value of the wrong line
    await expect(result.getByText(/= 3\/8/).first()).toBeVisible();
    // the parent link carries no id and no photo
    const wa = result.getByRole("link", { name: "ಅಪ್ಪ-ಅಮ್ಮನಿಗೆ ಕಳುಹಿಸಿ" });
    const href = (await wa.getAttribute("href")) ?? "";
    expect(href.startsWith("https://wa.me/?text=")).toBeTruthy();
    expect(decodeURIComponent(href)).not.toMatch(/stu_|ses_|Ravi/);

    // the existing flow: Fix this now → Kannada lesson → 2 retries → gap closed
    await result.getByRole("button", { name: "ಈಗಲೇ ಸರಿಪಡಿಸಿ" }).click();
    await expect(page.getByRole("heading", { name: "ನಿಮ್ಮ ಕಿರು ಪಾಠ" })).toBeVisible({ timeout: 60_000 });
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

    expect(errors, "no console errors on the student screens").toEqual([]);
    await context.close();
  });
});
