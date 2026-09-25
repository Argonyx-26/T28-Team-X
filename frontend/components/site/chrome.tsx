import Link from "next/link";

import { RaahBadge } from "@/components/site/raah";
import { RAAH } from "@/lib/raah";
import { ROUTES, SITE, repoFile } from "@/lib/site";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`gg-focus rounded-md font-hand text-[28px] font-bold leading-none text-ink ${className}`}>
      GuruGraph
    </Link>
  );
}

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#numbers", label: "Numbers" },
  { href: ROUTES.dashboard, label: "Class dashboard" },
];

export function SiteHeader({ page }: { page: "home" | "judges" }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
      <Wordmark />
      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="gg-focus hidden rounded-lg px-3 py-2 text-[15px] font-medium text-graphite transition-colors hover:text-ink md:inline-block"
          >
            {item.label}
          </Link>
        ))}
        {page === "home" ? (
          <Link href={ROUTES.judges} className="gg-btn min-h-10 px-4 text-[15px]">
            For judges
          </Link>
        ) : (
          <Link href={ROUTES.scan} className="gg-btn gg-btn-primary min-h-10 px-4 text-[15px]">
            Start the demo
          </Link>
        )}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-rule bg-white/80">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-sm text-[15px] leading-relaxed text-graphite">
            Built in 24 hours at ARGONYX &apos;26, RV University, by Team X: Samartha Puthraya K, Rishabh Arun and
            Risheeth S.
          </p>
          <RaahBadge />
        </div>
        <FooterLinks
          title="Try it"
          links={[
            { href: ROUTES.scan, label: "Scan a notebook" },
            { href: ROUTES.dashboard, label: "Class 7B dashboard" },
            { href: ROUTES.asha, label: "Be Asha, the demo student" },
            { href: ROUTES.school, label: "The school view" },
            { href: ROUTES.newClass, label: "Create your own class" },
            { href: ROUTES.judges, label: "For judges" },
          ]}
        />
        <FooterLinks
          title="Check our work"
          links={[
            { href: SITE.repo, label: "Source code on GitHub", external: true },
            { href: `${SITE.repo}#evaluation`, label: "How we evaluate", external: true },
            { href: repoFile("docs/research/EVIDENCE.md"), label: "Sourced evidence brief", external: true },
            { href: SITE.apiDocs, label: "Live API reference", external: true },
            ...(RAAH.statusPage ? [{ href: RAAH.statusPage, label: "Status page", external: true }] : []),
          ]}
        />
      </div>
    </footer>
  );
}

function FooterLinks({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; external?: boolean }[];
}) {
  return (
    <div>
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-graphite">{title}</h2>
      <ul className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noreferrer" className="gg-link text-[15px]">
                {l.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link href={l.href} className="gg-link text-[15px]">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
