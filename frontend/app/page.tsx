import Link from "next/link";
import { ArrowRight, GitBranch, Play, QrCode, Sparkles } from "lucide-react";

const features = [
  {
    title: "Reads handwriting",
    text: "Snap a notebook page and GuruGraph finds the wrong step.",
  },
  {
    title: "Agents that argue",
    text: "Diagnostician, Analyst and Coach debate what the teacher should re-teach.",
  },
  {
    title: "Kannada, Hindi, English",
    text: "Every child gets the lesson in a language they understand.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen text-[#1F2B5C]">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#D6DDE9] bg-white text-lg font-bold shadow-sm">
            G
          </div>
          <div>
            <div className="font-semibold tracking-tight">GuruGraph</div>
            <div className="text-xs text-[#616874]">Teaching intelligence</div>
          </div>
        </Link>

        <Link
          href="/judges"
          className="rounded-lg border border-[#D6DDE9] bg-white px-4 py-2 text-sm font-medium transition hover:border-[#3E4C85]"
        >
          Judges view
        </Link>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-16 pt-10 sm:px-8 md:grid-cols-[1.15fr_.85fr] md:items-center md:pt-20">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#D6DDE9] bg-white px-3 py-1.5 text-sm text-[#616874] shadow-sm">
            <Sparkles className="h-4 w-4" />
            Multi-agent learning ecosystem
          </div>

          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            See <span className="relative inline-block">why</span> they got it
            wrong.
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#616874]">
            Snap a notebook page. GuruGraph finds the wrong step, tells the
            teacher what to re-teach tomorrow, and gives each child a lesson
            in their own language.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/join/7B?as=asha"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1F2B5C] px-5 font-medium text-white transition hover:bg-[#3E4C85] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E4C85]"
            >
              Try it as a student (Asha)
              <ArrowRight className="h-4 w-4" />
            </Link>

            <Link
              href="/teacher/7B"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#D6DDE9] bg-white px-5 font-medium transition hover:border-[#3E4C85] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E4C85]"
            >
              Open teacher dashboard
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#616874]">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#2F8A57]" />
              Live demo ready
            </span>
            <span>Argonyx&apos;26</span>
            <span>Raah</span>
          </div>
        </div>

        <div className="relative">
          <div className="rounded-[24px] border border-[#D6DDE9] bg-white p-4 shadow-[0_12px_40px_rgba(31,43,92,0.08)]">
            <div className="rounded-[18px] border border-[#D6DDE9] bg-[#FCFDFF] p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Why Asha got it wrong</div>
                  <div className="text-xs text-[#616874]">Fractions · Q3</div>
                </div>
                <span className="rounded-full bg-[#F7E96B] px-2.5 py-1 text-xs font-medium">
                  Gap found
                </span>
              </div>

              <div className="rounded-xl border border-[#D6DDE9] bg-white p-4">
                <div className="font-[var(--font-hand)] text-2xl">
                  2/3 + 1/3 = 3/6
                </div>
                <div className="mt-3 h-1 rounded-full bg-[#C8372D]" />
                <div className="mt-2 text-sm text-[#C8372D]">
                  Wrong denominator step
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#D6DDE9] p-3">
                  <div className="text-xs text-[#616874]">Knowledge gap</div>
                  <div className="mt-1 font-semibold">Equivalent fractions</div>
                </div>
                <div className="rounded-xl border border-[#D6DDE9] p-3">
                  <div className="text-xs text-[#616874]">Tomorrow</div>
                  <div className="mt-1 font-semibold">Re-teach for 12 min</div>
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-[#F3F4F6] p-3 text-sm">
                <span className="font-semibold">Coach:</span> Start with a
                visual fraction model before retrying Q3.
              </div>
            </div>
          </div>

          <div className="absolute -bottom-5 -left-4 hidden rounded-xl border border-[#D6DDE9] bg-white px-4 py-3 shadow-md sm:block">
            <div className="text-xs text-[#616874]">Language</div>
            <div className="font-[var(--font-kn)] text-sm">ಕನ್ನಡ</div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-[#D6DDE9] bg-white p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold">{feature.title}</h2>
              <p className="mt-2 leading-7 text-[#616874]">{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
        <div className="grid gap-5 rounded-2xl border border-[#D6DDE9] bg-white p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="text-sm font-semibold">See GuruGraph in action</div>
            <p className="mt-1 text-sm text-[#616874]">
              Watch the demo, inspect the code, or check the live system.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-lg border border-[#D6DDE9] px-4 py-2 text-sm font-medium"
              >
                <Play className="h-4 w-4" />
                Demo video
              </a>
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-[#D6DDE9] px-4 py-2 text-sm font-medium"
              >
                <GitBranch className="h-4 w-4" />
                Repository
              </a>
              <a
                href="#status"
                className="inline-flex items-center gap-2 rounded-lg border border-[#D6DDE9] px-4 py-2 text-sm font-medium"
              >
                Status
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-[#D6DDE9] p-4">
            <QrCode className="h-8 w-8" />
            <div>
              <div className="text-xs text-[#616874]">Student demo</div>
              <div className="font-semibold">7B · Asha</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#D6DDE9] bg-white/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-sm text-[#616874] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>GuruGraph · Argonyx&apos;26</span>
          <span className="font-[var(--font-hand)] text-base">
            Built with Raah
          </span>
        </div>
      </footer>
    </main>
  );
}