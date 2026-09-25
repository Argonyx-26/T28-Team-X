// The numbers on the landing page and /judges come only from GET /judges/summary,
// so they change the moment an evaluation is re-run. Nothing here is hard-coded.

export type SummaryNumber = {
  label: string;
  value: string;
  n: number | null;
  method: string;
  kind?: string;
};

export type Summary = {
  numbers: SummaryNumber[];
  links: { app: string; repo: string; video: string | null; status_page: string | null };
};

export type Health = { ok: boolean; version: string; demo_mode: string; providers: Record<string, boolean> };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/backend${path}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The API answered ${res.status}.`);
  return (await res.json()) as T;
}

// Several parts of one page read the summary; they share one request for a few seconds.
const shared = new Map<string, { at: number; promise: Promise<unknown> }>();

function sharedJson<T>(path: string, fresh = false): Promise<T> {
  const hit = shared.get(path);
  if (!fresh && hit && Date.now() - hit.at < 5_000) return hit.promise as Promise<T>;
  const promise = getJson<T>(path);
  shared.set(path, { at: Date.now(), promise });
  promise.catch(() => shared.delete(path));
  return promise;
}

export const fetchSummary = (fresh = false) => sharedJson<Summary>("/judges/summary", fresh);
export const fetchHealth = (fresh = false) => sharedJson<Health>("/health", fresh);

// The one result we lead with: handwriting beats typed answers, and the wrong step beats the label.
const KEY_ORDER = [
  "Wrong step circled correctly",
  "Misconception named correctly from a photo",
  "Handwritten work marked right or wrong correctly",
  "Mistake named correctly from a typed answer alone (LLM fallback)",
];

// What the landing page shows first, in this order, when the number exists. Live counters since the last
// reset (they include our own testing) stay on /judges, where their method says so.
const LANDING_ORDER = [
  "Wrong step circled correctly",
  "Misconception named correctly from a photo",
  "Photo diagnosis time (median / p95)",
  "AI cost per student per month",
  "Mistake named correctly from a typed answer alone (LLM fallback)",
  "Questions in the verified bank",
];

const isLive = (x: SummaryNumber) => x.method.includes("since the last reset");

/** An evaluation run beats a live counter with the same label. */
export function tidy(numbers: SummaryNumber[]): SummaryNumber[] {
  const evaluated = new Set(numbers.filter((x) => x.kind).map((x) => x.label));
  return numbers.filter((x) => x.kind || !evaluated.has(x.label));
}

export function keyResult(numbers: SummaryNumber[]): SummaryNumber | null {
  for (const label of KEY_ORDER) {
    const hit = numbers.find((x) => x.label === label);
    if (hit) return hit;
  }
  return null;
}

export function landingNumbers(numbers: SummaryNumber[], count = 4): SummaryNumber[] {
  const clean = tidy(numbers);
  const picked: SummaryNumber[] = [];
  for (const label of LANDING_ORDER) {
    const hit = clean.find((x) => x.label === label);
    if (hit && picked.length < count) picked.push(hit);
  }
  return picked;
}

export function groupNumbers(numbers: SummaryNumber[]) {
  const clean = tidy(numbers);
  return [
    {
      title: "Evaluations",
      note: "Run on problems the model had not seen, with the right answer known before the run.",
      items: clean.filter((x) => x.kind),
    },
    {
      title: "Measured live",
      note: "Counted by the server on real calls since the demo class was last reset.",
      items: clean.filter((x) => !x.kind && isLive(x)),
    },
    {
      title: "Cost and coverage",
      note: "Measured from real calls and checked in the test suite.",
      items: clean.filter((x) => !x.kind && !isLive(x)),
    },
  ].filter((g) => g.items.length);
}
