"use client";

import Link from "next/link";
import { useState } from "react";

import { ROUTES } from "@/lib/site";
import { usePenLength } from "@/lib/use-pen-length";

// The real result for our sample notebook (the same photo as "Asha, 3/4 + 1/4" on the scan screen).
const STEPS = ["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"];
const WRONG = 2;
const LABEL = "added the denominators too";
const PROOF = "4/8 is exactly what you get if you add the denominators too.";

/** The same hand-drawn ellipse the scan screen uses: a teacher's red pen around one line. */
function PenCircle() {
  const pen = usePenLength<SVGPathElement>();
  return (
    <svg
      className="pointer-events-none absolute -inset-x-5 -inset-y-3.5 h-[calc(100%+28px)] w-[calc(100%+40px)] overflow-visible"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        ref={pen}
        className="gg-pen"
        d="M8,22 C6,9 32,3 55,4 C80,5 97,11 95,21 C93,32 70,37 48,36 C24,35 5,31 7,19 C8,13 16,9 26,7"
      />
    </svg>
  );
}

export function NotebookDemo() {
  const [run, setRun] = useState(0);
  return (
    <figure className="gg-panel relative flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-semibold text-ink">
          Asha&apos;s notebook <span className="font-normal text-graphite">· Class 7B</span>
        </p>
        <p className="rounded-full border border-rule bg-paper px-3 py-1 font-hand text-[16px] text-ink">
          3/4 + 1/4 = ?
        </p>
      </div>

      {/* keyed by run, so "Play again" replays every animation from the start */}
      <div key={run} className="flex flex-col gap-4">
        <div className="gg-ruled relative overflow-hidden rounded-[14px] border border-rule py-3 pl-14 pr-3">
          <span className="gg-scan" aria-hidden />
          <ol className="flex flex-col" aria-label="The working, as read from the photo">
            {STEPS.map((line, i) => {
              const n = i + 1;
              const wrong = n === WRONG;
              return (
                <li key={line} className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-4">
                  <span className="relative px-2.5 font-hand text-[clamp(24px,6.4vw,30px)] leading-tight text-[#22307a]">
                    {line}
                    {wrong && <PenCircle />}
                  </span>
                  {wrong && (
                    <span
                      className="gg-late -rotate-3 font-hand text-[19px] leading-tight text-red-pen"
                      style={{ ["--late-delay" as string]: "1450ms" }}
                    >
                      {LABEL}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="sr-only">
            Line {WRONG} is circled in red: {LABEL}.
          </p>
        </div>

        <p
          className="gg-late rounded-[10px] border border-rule border-l-4 border-l-green bg-white px-3.5 py-2.5 text-[15px] leading-snug text-ink"
          style={{ ["--late-delay" as string]: "1850ms" }}
        >
          <span className="font-semibold text-[#24724a]">✓ Checked by exact arithmetic, not the AI.</span> {PROOF}
        </p>

        <ul
          className="gg-late grid gap-2 text-[14px] sm:grid-cols-2"
          style={{ ["--late-delay" as string]: "2250ms" }}
          aria-label="What happens next"
        >
          <li className="rounded-[10px] bg-muted px-3 py-2 text-ink">
            <span className="font-semibold">Teacher:</span> a 5-minute re-teach plan for everyone who made this mistake
          </li>
          <li className="rounded-[10px] bg-muted px-3 py-2 text-ink">
            <span className="font-semibold">Asha:</span> a short lesson in Kannada and 2 retry questions
          </li>
        </ul>
      </div>

      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-graphite">
        <span>
          The real result for our sample page.{" "}
          <Link href={ROUTES.scan} className="gg-link">
            Try it live
          </Link>
        </span>
        <button type="button" onClick={() => setRun((n) => n + 1)} className="gg-link text-[13px]">
          ↻ Play again
        </button>
      </figcaption>
    </figure>
  );
}
