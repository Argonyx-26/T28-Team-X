"use client";

import Script from "next/script";
import { useSyncExternalStore } from "react";

import { RAAH, raahActive, raahOn } from "@/lib/raah";

const noop = () => () => {};

/** The Raah beacon, once in the root layout. It loads only on the production domain and never in automated tests. */
export function RaahBeacon() {
  const active = useSyncExternalStore(noop, raahActive, () => false);
  if (!active) return null;
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

/** Raah's public badge: live visitors and site stats for the production domain (turned on in the project's Public badge tab). */
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
