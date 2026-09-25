/**
 * A real multi-problem notebook page on the scan screen: every problem is found and judged as written, each wrong line
 * is circled, and the teacher can correct one problem without touching the others. Uses its own class, never 7B.
 */
import { expect, test } from "@playwright/test";
import { join } from "node:path";

const PAGE = join(__dirname, "..", "..", "data", "evidence", "incoming", "risheeth_page1.jpg");

test("a three-problem page: all three found, two circled, one corrected", async ({ page, request }) => {
  const created = await request.post("/backend/sessions/create", { data: { class_name: `Scan page ${Date.now() % 100000}` } });
  expect(created.ok()).toBeTruthy();
  const { code } = (await created.json()) as { code: string };
  const joined = await request.post("/backend/students/join", { data: { code, nickname: "Risheeth", language: "en", roll_no: 1 } });
  expect(joined.ok()).toBeTruthy();

  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`/teacher/${code}/scan`);
  const upload = page.getByRole("button", { name: /Photograph or upload/ });
  await expect(upload).toBeEnabled({ timeout: 30_000 });
  await page.locator('input[type="file"]').setInputFiles(PAGE);

  const diagnosis = page.getByRole("region", { name: "Diagnosis" });
  await expect(diagnosis.getByText(/3 problems, 2 to fix/)).toBeVisible({ timeout: 90_000 });
  const cards = diagnosis.getByRole("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("2/3 + 4/7");
  await expect(cards.nth(0)).toContainText("Line 2:");
  await expect(cards.nth(1)).toContainText("5/6 + 7/8");
  await expect(cards.nth(2)).toContainText("✓ right");
  // the red pen on the photo: one ellipse per wrong line
  await expect(diagnosis.locator("img[alt='The notebook photo'] ~ svg")).toHaveCount(2);

  // the teacher corrects problem 2 only
  await cards.nth(1).getByRole("button", { name: /It's actually right/ }).click();
  await expect(cards.nth(1).getByText(/Marked right/)).toBeVisible();
  await expect(cards.nth(0).getByRole("button", { name: /Yes, that's the mistake/ })).toBeVisible();
  expect(errors).toEqual([]);
});
