import Link from "next/link";

import { ROUTES } from "@/lib/site";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="gg-panel flex w-full max-w-md flex-col gap-4 p-6">
        <p className="font-hand text-[22px] text-red-pen">this page isn&apos;t in the notebook</p>
        <h1 className="text-[24px] font-bold leading-tight text-ink">We couldn&apos;t find that page.</h1>
        <p className="text-[15px] leading-relaxed text-graphite">
          If a teacher gave you a class code, open the class link they shared. Otherwise, start from the home page.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/" className="gg-btn gg-btn-primary">
            Home
          </Link>
          <Link href={ROUTES.dashboard} className="gg-btn">
            Class 7B dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
