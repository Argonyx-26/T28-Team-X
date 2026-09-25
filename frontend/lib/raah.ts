// Raah browser analytics (https://raah.dev/docs). The project id and domain are public: Raah prints them in every
// page's HTML. NEXT_PUBLIC_RAAH_* at build time overrides them (each read by its static name so Next inlines it).
export const RAAH = {
  pid: process.env.NEXT_PUBLIC_RAAH_PID || "proj_qf3983m8rn59rx18",
  domain: process.env.NEXT_PUBLIC_RAAH_DOMAIN || "gurugraph-web-215071922486.asia-south1.run.app",
  statusPage: process.env.NEXT_PUBLIC_RAAH_STATUS_URL || "",
};

export const raahOn = () => RAAH.pid.length > 0;

/**
 * True only on the production domain in a real browser. Raah rejects traffic whose domain doesn't match the project,
 * and our own browser tests (navigator.webdriver) must not count as visitors.
 */
export function raahActive(): boolean {
  if (typeof window === "undefined" || !raahOn()) return false;
  if (window.location.hostname !== RAAH.domain) return false;
  return !navigator.webdriver;
}

type Props = Record<string, string | number | boolean | null | undefined>;
type RaahQueue = { q?: unknown[][]; track?: (name: string, props: Record<string, string>) => void };

// never send who: property names that could carry an identity are dropped before anything leaves the browser
const IDENTIFYING = /(^|_)(id|nickname|name|student|email|phone|roll)(_|$)/i;

/**
 * Records a named event. Safe before the beacon loads (Raah drains the queue), with ad blockers (a no-op), on the
 * server and off the production domain (a no-op). At most 16 properties, values become strings of up to 255 chars.
 */
export function track(name: string, props: Props = {}): void {
  if (!raahActive()) return;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(props).slice(0, 16)) {
    if (value === null || value === undefined || IDENTIFYING.test(key)) continue;
    clean[key] = String(value).slice(0, 255);
  }
  const w = window as unknown as { raah?: RaahQueue };
  try {
    if (typeof w.raah?.track === "function") {
      w.raah.track(name.slice(0, 64), clean);
      return;
    }
    w.raah = w.raah ?? { q: [] };
    (w.raah.q ??= []).push(["track", name.slice(0, 64), clean]);
  } catch {
    // analytics must never break the class
  }
}
