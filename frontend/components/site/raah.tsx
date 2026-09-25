import Script from "next/script";

import { RAAH, raahOn } from "@/lib/raah";

/** The Raah beacon, loaded once in the root layout (Raah's SPA guidance). Off until a project id is set. */
export function RaahBeacon() {
  if (!raahOn()) return null;
  return (
    <Script
      id="raah-beacon"
      src="https://t.raah.dev/script.js"
      data-pid={RAAH.pid}
      data-domain={RAAH.domain}
      strategy="afterInteractive"
    />
  );
}

/** Raah's public badge: live visitors and site stats, rendered inline. */
export function RaahBadge() {
  if (!raahOn()) return null;
  return (
    <>
      <div
        data-raah-live
        data-pid={RAAH.pid}
        data-domain={RAAH.domain}
        data-theme="light"
        data-sticky="false"
        aria-label="Live visitors, measured by Raah"
      />
      <Script id="raah-badge" src="https://t.raah.dev/badge.js" strategy="lazyOnload" />
    </>
  );
}
