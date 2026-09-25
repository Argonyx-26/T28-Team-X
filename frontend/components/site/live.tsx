"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { RAAH } from "@/lib/raah";
import { ROUTES, SITE } from "@/lib/site";
import {
  type Health,
  type Summary,
  type SummaryNumber,
  fetchHealth,
  fetchSummary,
  groupNumbers,
  keyResult,
  landingNumbers,
} from "@/lib/summary";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

function useLive<T>(fetcher: (fresh: boolean) => Promise<T>) {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    fetcher(attempt > 0).then(
      (data) => live && setLoad({ state: "ready", data }),
      (e: unknown) => live && setLoad({ state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [fetcher, attempt]);
  const retry = useCallback(() => {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return [load, retry] as const;
}

export const useSummary = () => useLive<Summary>(fetchSummary);

/* ---------- numbers ---------- */

function NumberCard({ item, highlight = false }: { item: SummaryNumber; highlight?: boolean }) {
  return (
    <article
      className={`gg-panel flex h-full flex-col gap-2 p-5 ${highlight ? "ring-2 ring-red-pen/25" : ""}`}
      aria-label={`${item.label}: ${item.value}${item.n !== null ? `, n = ${item.n}` : ""}`}
    >
      {highlight && (
        <span className="w-fit rounded-full border border-red-pen/40 px-2.5 py-0.5 font-hand text-[15px] leading-tight text-red-pen">
          key result
        </span>
      )}
      <p className="text-[15px] font-semibold leading-snug text-ink">{item.label}</p>
      <p className="text-[40px] font-bold leading-none tracking-tight text-ink tabular-nums">
        <span className={highlight ? "gg-highlight" : undefined}>{item.value}</span>
      </p>
      {item.n !== null && (
        <p className="text-[13px] font-semibold text-ink-2">
          n = {item.n}
          {item.kind ? " · evaluation" : ""}
        </p>
      )}
      <p className="mt-auto border-t border-rule pt-3 text-[13px] leading-relaxed text-graphite">{item.method}</p>
    </article>
  );
}

function NumbersSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading the live numbers">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="gg-panel flex h-52 flex-col gap-3 p-5">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-10 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-auto h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function NumbersError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="gg-panel flex flex-col items-start gap-3 border-l-4 border-l-red-pen p-5" role="alert">
      <p className="font-semibold text-ink">The live numbers didn&apos;t load.</p>
      <p className="text-[15px] text-graphite">
        They come straight from our API, so this usually means the connection dropped. The app itself still works.
      </p>
      <button type="button" className="gg-btn min-h-10" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** The landing page's four headline numbers, straight from GET /judges/summary. */
export function HeadlineNumbers() {
  const [load, retry] = useSummary();
  if (load.state === "loading") return <NumbersSkeleton count={4} />;
  if (load.state === "error") return <NumbersError onRetry={retry} />;
  const items = landingNumbers(load.data.numbers);
  const key = keyResult(load.data.numbers);
  const cols = items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${cols}`}>
      {items.map((item) => (
        <NumberCard key={item.label} item={item} highlight={item === key} />
      ))}
    </div>
  );
}

/** Every number, grouped by how it was measured. For /judges. */
export function AllNumbers() {
  const [load, retry] = useSummary();
  if (load.state === "loading") return <NumbersSkeleton count={4} />;
  if (load.state === "error") return <NumbersError onRetry={retry} />;
  const key = keyResult(load.data.numbers);
  const groups = groupNumbers(load.data.numbers);
  return (
    <div className="flex flex-col gap-10">
      {groups.map((g) => (
        <section key={g.title} aria-labelledby={`numbers-${g.title}`}>
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <h3 id={`numbers-${g.title}`} className="text-[18px] font-semibold text-ink">
              {g.title}
            </h3>
            <p className="text-[14px] text-graphite">{g.note}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((item) => (
              <NumberCard key={`${item.label}-${item.kind ?? ""}`} item={item} highlight={item === key} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Demo video and status page links, shown only once they exist. */
export function ProjectLinks() {
  const [load] = useSummary();
  const api = load.state === "ready" ? load.data.links : null;
  const video = SITE.video || api?.video || null;
  const status_page = SITE.statusPage || RAAH.statusPage || api?.status_page || null;
  if (!video && !status_page) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {video && (
        <a href={video} target="_blank" rel="noreferrer" className="gg-btn">
          Watch the 2-minute demo video<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {status_page && (
        <a href={status_page} target="_blank" rel="noreferrer" className="gg-btn">
          Status page<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </div>
  );
}

/* ---------- API status ---------- */

export function ApiStatus() {
  const [load] = useLive<Health>(fetchHealth);
  const up = load.state === "ready" && load.data.ok;
  const vision = load.state === "ready" && Object.values(load.data.providers).some(Boolean);
  const text =
    load.state === "loading"
      ? "Checking the live API…"
      : up
        ? vision
          ? "Live API is up · Gemini on Vertex AI connected"
          : "Live API is up · AI provider not connected, rules only"
        : "Live API unreachable right now";
  return (
    <p className="inline-flex items-center gap-2 text-[14px] font-medium text-graphite" role="status">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 rounded-full ${
          load.state === "loading" ? "bg-rule" : up && vision ? "bg-green" : up ? "bg-amber" : "bg-red-pen"
        }`}
      />
      {text}
    </p>
  );
}

/* ---------- QR to join class 7B ---------- */

const noop = () => () => {};

export function JoinQr({ size = 168 }: { size?: number }) {
  // the page's own origin, read on the client only, so the code works on any deployment
  const origin = useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => null,
  );
  const url = origin ? `${origin}${ROUTES.join}` : null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="rounded-2xl border border-rule bg-white p-3"
        style={{ width: size + 26, height: size + 26 }}
        role="img"
        aria-label="QR code that opens class 7B on your phone"
      >
        {url ? (
          <QRCodeSVG value={url} size={size} level="M" fgColor="#1f2b5c" bgColor="#ffffff" />
        ) : (
          <div className="h-full w-full animate-pulse rounded-lg bg-muted" />
        )}
      </div>
      <Link href={ROUTES.join} className="gg-link max-w-full text-center text-[13px] break-all">
        {url ? url.replace(/^https?:\/\//, "") : "Open class 7B"}
      </Link>
    </div>
  );
}
