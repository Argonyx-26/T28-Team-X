"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ExternalLink,
  GitBranch,
  QrCode,
  RefreshCw,
  Video,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/api";
import type { JudgesSummary } from "@/lib/types";

export default function JudgesPage() {
  const [data, setData] = useState<JudgesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.getJudgesSummary();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load judges summary.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
  const timer = window.setTimeout(() => {
    void load();
  }, 0);

  return () => window.clearTimeout(timer);
}, []);

  const ashaUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "/join/7B?as=asha";
    }

    return `${window.location.origin}/join/7B?as=asha`;
  }, []);

  const importantNumberIndex = useMemo(() => {
    if (!data?.numbers.length) return -1;

    return data.numbers.reduce(
      (best, item, index, numbers) =>
        item.n !== null && (numbers[best]?.n === null || item.n > (numbers[best]?.n ?? -1))
          ? index
          : best,
      0,
    );
  }, [data]);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="font-heading text-xl font-bold tracking-tight text-[var(--ink)]">
            GuruGraph
          </Link>

          <Link
            href="/"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
          >
            Back to home
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-[var(--red-pen)]">
            Judges view
          </p>

          <h1 className="font-heading text-4xl font-bold tracking-tight text-[var(--ink)] sm:text-6xl">
            See the system in action.
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--graphite)] sm:text-lg">
            GuruGraph connects student diagnosis, agent debate, teacher planning,
            and personalised learning into one classroom loop.
          </p>
        </div>

        {loading ? (
          <section
            aria-label="Loading judges summary"
            className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-40 animate-pulse rounded-2xl border border-border bg-white"
              />
            ))}
          </section>
        ) : error ? (
          <section className="mt-10 rounded-2xl border border-[var(--red)]/30 bg-white p-6">
            <p className="font-semibold text-[var(--red)]">Could not load the judges summary.</p>
            <p className="mt-2 text-sm text-[var(--graphite)]">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          </section>
        ) : (
          <>
            <section
              aria-label="Key project numbers"
              className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {data?.numbers.length ? (
                data.numbers.map((item, index) => (
                  <article
                    key={`${item.label}-${index}`}
                    className={`rounded-2xl border bg-white p-6 shadow-sm ${
                      index === importantNumberIndex
                        ? "border-[var(--red-pen)] ring-2 ring-[var(--red-pen)]/10"
                        : "border-border"
                    }`}
                  >
                    {index === importantNumberIndex && (
                      <span className="inline-flex rounded-full bg-[var(--highlighter)] px-2.5 py-1 text-xs font-bold text-[var(--ink)]">
                        Key result
                      </span>
                    )}

                    <p className="mt-3 text-sm font-semibold text-[var(--graphite)]">
                      {item.label}
                    </p>

                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-heading text-5xl font-bold text-[var(--ink)]">
                        {item.n ?? item.value}
                      </span>

                      {item.n !== null && item.value !== String(item.n) && (
                        <span className="text-sm font-semibold text-[var(--graphite)]">
                          {item.value}
                        </span>
                      )}
                    </div>

                    <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-[var(--graphite)]">
                      {item.method}
                    </p>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-white p-8 sm:col-span-2 lg:col-span-3">
                  <p className="font-semibold text-[var(--ink)]">No judge metrics available yet.</p>
                  <p className="mt-1 text-sm text-[var(--graphite)]">
                    The backend has not supplied summary numbers for this run.
                  </p>
                </div>
              )}
            </section>

            <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
              <div className="rounded-2xl border border-border bg-white p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <QrCode className="h-5 w-5 text-[var(--ink)]" />
                  <h2 className="font-heading text-2xl font-bold text-[var(--ink)]">
                    Try it as Asha
                  </h2>
                </div>

                <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--graphite)]">
                  Scan the QR code or open the student demo directly. This launches
                  Class 7B as Asha.
                </p>

                <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
                  <div className="rounded-2xl border border-border bg-white p-4">
                    <QRCodeSVG
                      value={ashaUrl}
                      size={180}
                      level="M"
                      includeMargin
                      aria-label="QR code to try GuruGraph as Asha"
                    />
                  </div>

                  <div>
                    <Link
                      href="/join/7B?as=asha"
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
                    >
                      Try it as Asha
                      <ArrowRight className="h-4 w-4" />
                    </Link>

                    <p className="mt-3 text-xs text-[var(--graphite)]">
                      Student demo · Class 7B
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="font-heading text-xl font-bold text-[var(--ink)]">
                  Project links
                </h2>

                <div className="mt-5 space-y-3">
                  {data?.links.app && (
                    <a
                      href={data.links.app}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-xl border border-border p-4 text-sm font-semibold text-[var(--ink)] hover:bg-muted"
                    >
                      <span className="flex items-center gap-3">
                        <ArrowRight className="h-4 w-4" />
                        Live app
                      </span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}

                  {data?.links.repo && (
                    <a
                      href={data.links.repo}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-xl border border-border p-4 text-sm font-semibold text-[var(--ink)] hover:bg-muted"
                    >
                      <span className="flex items-center gap-3">
                        <GitBranch className="h-4 w-4" />
                        Repository
                      </span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}

                  {data?.links.video && (
                    <a
                      href={data.links.video}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-xl border border-border p-4 text-sm font-semibold text-[var(--ink)] hover:bg-muted"
                    >
                      <span className="flex items-center gap-3">
                        <Video className="h-4 w-4" />
                        Demo video
                      </span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}

                  {data?.links.status_page && (
                    <a
                      href={data.links.status_page}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-xl border border-border p-4 text-sm font-semibold text-[var(--ink)] hover:bg-muted"
                    >
                      <span>Status page</span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}