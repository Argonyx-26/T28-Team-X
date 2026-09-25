// Raah browser analytics (https://raah.dev/docs). The project id and domain are public:
// they are printed in every page's HTML. Paste the id from the Raah project page here.
export const RAAH = {
  pid: process.env.NEXT_PUBLIC_RAAH_PID ?? "",
  domain: process.env.NEXT_PUBLIC_RAAH_DOMAIN ?? "gurugraph-web-215071922486.asia-south1.run.app",
  statusPage: process.env.NEXT_PUBLIC_RAAH_STATUS_URL ?? "",
};

export const raahOn = () => RAAH.pid.length > 0;

type Props = Record<string, string | number | boolean | null | undefined>;
type RaahQueue = { q?: unknown[][]; track?: (name: string, props: Record<string, string>) => void };

/**
 * Records a named event. Safe before the beacon loads (Raah drains the queue),
 * with ad blockers (a no-op) and on the server (a no-op). Values become strings, as Raah stores them.
 */
export function track(name: string, props: Props = {}): void {
  if (typeof window === "undefined" || !raahOn()) return;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && value !== undefined) clean[key] = String(value).slice(0, 255);
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
