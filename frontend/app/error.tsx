"use client";

import Link from "next/link";
import { useEffect } from "react";

import { ROUTES } from "@/lib/site";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // lets Raah's error report (and the browser console) see what broke
    window.reportError?.(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="gg-panel flex w-full max-w-md flex-col gap-4 border-l-4 border-l-red-pen p-6" role="alert">
        <p className="font-hand text-[22px] text-red-pen">oops, a smudge</p>
        <h1 className="text-[24px] font-bold leading-tight text-ink">This page hit a problem.</h1>
        <p className="text-[15px] leading-relaxed text-graphite">
          Your class data is safe. Try again, and if it keeps happening, open the class dashboard and carry on from there.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={reset} className="gg-btn gg-btn-primary">
            Try again
          </button>
          <Link href={ROUTES.dashboard} className="gg-btn">
            Class dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
