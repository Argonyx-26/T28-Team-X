import Link from "next/link";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { HeadlineNumbers, JoinQr } from "@/components/site/live";
import { NotebookDemo } from "@/components/site/notebook-demo";
import { ROUTES, SITE } from "@/lib/site";

// Every figure below is checked on its source page (docs/research/EVIDENCE.md).
const PROBLEM = [
  {
    stat: "29%",
    text: "of fraction questions answered correctly by Class 6 students, their weakest maths skill.",
    source: "NCERT PARAKH national survey, 2024 (21 lakh students)",
    href: "https://parakh.ncert.gov.in/sites/default/files/2025-07/REPORT_India_IND.pdf",
  },
  {
    stat: "1 in 4",
    text: "teachers say they have too much correction work (22–25%). A red cross doesn't tell them why a child went wrong.",
    source: "TISS State of Teachers survey, 3,615 teachers, 2023",
    href: "https://tiss.ac.in/uploads/files/SOTTTER_23_final_version.pdf",
  },
  {
    stat: "No gain",
    text: "in learning from diagnostic reports alone in an Indian trial, because nothing changed in the next lesson.",
    source: "Muralidharan & Sundararaman, Andhra Pradesh RCT",
    href: "https://www.povertyactionlab.org/evaluation/impact-diagnostic-feedback-teachers-student-learning-india-0",
  },
];

const LOOP = [
  {
    title: "Scan the notebook",
    text: "The teacher photographs a page. Gemini reads the handwriting; exact fraction arithmetic checks which step went wrong and names the mistake.",
    href: ROUTES.scan,
    cta: "Scan a notebook",
  },
  {
    title: "See the whole class",
    text: "A map of 8 fraction concepts and a student-by-concept heatmap fill in as answers arrive, so the teacher sees who is stuck where.",
    href: ROUTES.dashboard,
    cta: "Open class 7B",
  },
  {
    title: "Agents argue, the teacher decides",
    text: "The Coach drafts tomorrow's 5-minute plan. The Analyst checks it against every child's answers and can veto it. The teacher approves and prints a worksheet.",
    href: ROUTES.dashboard,
    cta: "Plan tomorrow's lesson",
  },
  {
    title: "Close the gap",
    text: "Each child gets a short lesson in Kannada, Hindi or English and two retry questions. Both right, the gap closes. Parents get a WhatsApp voice note.",
    href: ROUTES.asha,
    cta: "Be Asha, the student",
  },
];

// Condensed from a real run on class 7B; the full transcript is in the README.
const DEBATE: { who: "Coach" | "Analyst" | "Teacher"; act: string; verdict?: "no" | "yes"; text: string }[] = [
  {
    who: "Coach",
    act: "drafts",
    text: "Plan 1, whole class: fix “adding without making the denominators the same”. Plan 2, a group of 13: “Stop adding the denominators too”.",
  },
  {
    who: "Analyst",
    act: "sends plan 1 back",
    verdict: "no",
    text: "No student shows that mistake; target a mistake the class actually makes. Plan 2 accepted: 13 of 31 students show “added the denominators too”.",
  },
  { who: "Coach", act: "revises", text: "Two re-teach plans for the same 13 students." },
  {
    who: "Analyst",
    act: "sends plan 2 back",
    verdict: "no",
    text: "Plan 2 repeats plan 1 for the same students; give the other 18 students practice instead.",
  },
  { who: "Coach", act: "revises", text: "Group A (13) re-learns adding with the same denominator. Group B (18) practises." },
  { who: "Analyst", act: "accepts", verdict: "yes", text: "Both plans fit the class." },
  { who: "Teacher", act: "approves", verdict: "yes", text: "and prints a worksheet for Group A." },
];

const AI_JOBS = ["Reading handwriting from a phone photo", "Writing lessons, plans and parent messages in 3 languages"];
const RULE_JOBS = [
  "Right or wrong, by exact fraction arithmetic: a model can never mark a right answer wrong",
  "Which mistake a known wrong answer shows",
  "Mastery, the next question, and when a gap opens or closes",
  "The Analyst's veto over every plan",
];

const avatar = { Coach: "bg-[#8a5a1d]", Analyst: "bg-red-pen", Teacher: "bg-ink" } as const;

function SectionTitle({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <div className="mb-8 flex flex-col gap-2">
      <p className="font-hand text-[20px] text-red-pen">{eyebrow}</p>
      <h2 id={id} className="max-w-3xl text-[clamp(28px,4.2vw,40px)] font-bold leading-[1.1] tracking-tight text-ink">
        {title}
      </h2>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 text-[14px] leading-relaxed text-graphite">
      {items.map((j) => (
        <li key={j} className="flex gap-2">
          <span aria-hidden className="text-ink-2">
            •
          </span>
          {j}
        </li>
      ))}
    </ul>
  );
}

function External({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`gg-link ${className}`}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader page="home" />

      <main className="flex flex-col">
        {/* hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-16 pt-4 sm:px-8 md:pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div className="flex flex-col gap-6">
            <p className="w-fit rounded-full border border-rule bg-white px-3.5 py-1.5 text-[14px] text-graphite">
              For Class 7 maths teachers · <span lang="kn" className="font-kn">ಕನ್ನಡ</span> ·{" "}
              <span lang="hi">हिन्दी</span> · English
            </p>
            <h1 className="text-[clamp(42px,7.4vw,72px)] font-bold leading-[1.02] tracking-tight text-ink">
              See <span className="gg-highlight">why</span> they got it wrong.
            </h1>
            <p className="max-w-xl text-[clamp(17px,2vw,20px)] leading-relaxed text-graphite">
              Snap a photo of a student&apos;s notebook. GuruGraph circles the exact step that went wrong, tells the
              teacher what to re-teach tomorrow, and gives the child a short lesson in their own language.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={ROUTES.scan} className="gg-btn gg-btn-primary text-[16px]">
                Scan a notebook <span aria-hidden>→</span>
              </Link>
              <Link href={ROUTES.dashboard} className="gg-btn text-[16px]">
                Open the class dashboard
              </Link>
            </div>
            <p className="text-[15px] text-graphite">
              Or{" "}
              <Link href={ROUTES.asha} className="gg-link">
                be Asha, a student
              </Link>{" "}
              and close a gap in under a minute.
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-graphite" aria-label="How it runs">
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 rounded-full bg-green" /> Live on Google Cloud
              </li>
              <li>Photos stay in memory and are discarded</li>
              <li>The teacher has the last word</li>
            </ul>
          </div>
          <NotebookDemo />
        </section>

        {/* the problem */}
        <section aria-labelledby="why" className="border-y border-rule bg-white/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
            <SectionTitle
              id="why"
              eyebrow="why this matters"
              title="Teachers see a red cross. They rarely have time to see the reason."
            />
            <div className="grid gap-4 md:grid-cols-3">
              {PROBLEM.map((p) => (
                <article key={p.stat} className="gg-panel flex flex-col gap-3 p-6">
                  <p className="text-[44px] font-bold leading-none tracking-tight text-ink">{p.stat}</p>
                  <p className="text-[16px] leading-relaxed text-ink">{p.text}</p>
                  <External href={p.href} className="mt-auto text-[13px]">
                    {p.source}
                  </External>
                </article>
              ))}
            </div>
            <p className="mt-8 max-w-3xl text-[17px] leading-relaxed text-ink">
              So GuruGraph doesn&apos;t stop at the diagnosis. Every diagnosis ends in a plan for the teacher, a lesson
              for the child and two questions that show whether the gap is closed.
            </p>
          </div>
        </section>

        {/* the loop */}
        <section aria-labelledby="how" className="mx-auto w-full max-w-6xl scroll-mt-6 px-4 py-16 sm:px-8">
          <SectionTitle id="how" eyebrow="how it works" title="One photo in. A plan, a lesson and a closed gap out." />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LOOP.map((step, i) => (
              <li key={step.title} className="gg-panel flex flex-col gap-3 p-6">
                <span
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-red-pen font-hand text-[20px] font-bold text-red-pen"
                >
                  {i + 1}
                </span>
                <h3 className="text-[18px] font-semibold leading-snug text-ink">{step.title}</h3>
                <p className="text-[15px] leading-relaxed text-graphite">{step.text}</p>
                <Link href={step.href} className="gg-link mt-auto text-[15px]">
                  {step.cta} <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        {/* agents */}
        <section aria-labelledby="agents" className="border-y border-rule bg-white/70">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionTitle
                id="agents"
                eyebrow="agents that argue"
                title="The AI drafts. The numbers push back. The teacher decides."
              />
              <p className="mb-6 text-[16px] leading-relaxed text-graphite">
                The Coach sees what a mark book shows. The Analyst sees which child made which mistake, and its veto is
                binding. A plan that still fails after two rounds goes to the teacher; it is never hidden.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="gg-panel p-5">
                  <h3 className="mb-3 text-[15px] font-semibold text-ink">AI does two jobs</h3>
                  <Bullets items={AI_JOBS} />
                </div>
                <div className="gg-panel p-5">
                  <h3 className="mb-3 text-[15px] font-semibold text-ink">Rules do the rest</h3>
                  <Bullets items={RULE_JOBS} />
                </div>
              </div>
            </div>

            <figure className="gg-panel p-5 sm:p-6">
              <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-ink">Tomorrow&apos;s plan for class 7B</span>
                <span className="text-[13px] text-graphite">from a real run · 30 simulated students and Asha</span>
              </figcaption>
              <ol className="flex flex-col gap-3">
                {DEBATE.map((d, i) => (
                  <li
                    key={i}
                    className={`flex gap-3 rounded-[12px] border border-rule p-3 ${
                      d.verdict === "no"
                        ? "border-l-[3px] border-l-red-pen bg-[#fdf5f4]"
                        : d.verdict === "yes"
                          ? "border-l-[3px] border-l-green bg-white"
                          : "bg-white"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${avatar[d.who]}`}
                    >
                      {d.who[0]}
                    </span>
                    <p className="text-[14px] leading-relaxed text-ink">
                      <span className="font-semibold">
                        {d.who} {d.act}
                        {d.who === "Teacher" ? "" : ":"}
                      </span>{" "}
                      {d.text}
                    </p>
                  </li>
                ))}
              </ol>
            </figure>
          </div>
        </section>

        {/* numbers */}
        <section aria-labelledby="numbers" className="mx-auto w-full max-w-6xl scroll-mt-6 px-4 py-16 sm:px-8">
          <SectionTitle
            id="numbers"
            eyebrow="measured, not claimed"
            title="Every number shows its sample size and how we measured it."
          />
          <HeadlineNumbers />
          <p className="mt-6 text-[15px] text-graphite">
            These load live from our API.{" "}
            <Link href={ROUTES.judges} className="gg-link">
              See every number and its method
            </Link>
            .
          </p>
        </section>

        {/* try it */}
        <section aria-labelledby="try" className="border-y border-rule bg-white/70">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 sm:px-8 md:grid-cols-[auto_1fr]">
            <div className="order-2 md:order-1">
              <JoinQr />
            </div>
            <div className="order-1 flex flex-col gap-5 md:order-2">
              <SectionTitle id="try" eyebrow="try it now" title="Join class 7B from your phone." />
              <p className="-mt-4 max-w-2xl text-[17px] leading-relaxed text-graphite">
                Scan the code, pick a nickname and a language, and answer five questions. You&apos;ll appear on the
                teacher&apos;s heatmap as you go. Get one wrong, and GuruGraph teaches it back to you.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href={ROUTES.asha} className="gg-btn gg-btn-primary">
                  Be Asha, the demo student
                </Link>
                <Link href={ROUTES.dashboard} className="gg-btn">
                  Watch the class dashboard
                </Link>
                <Link href={ROUTES.pile} className="gg-btn">
                  Read a pile of notebooks
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* who it's for, and what we don't claim */}
        <section aria-labelledby="who" className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 sm:px-8 md:grid-cols-2">
          <div className="gg-panel flex flex-col gap-3 p-6">
            <p className="font-hand text-[20px] text-red-pen">who it&apos;s for</p>
            <h2 id="who" className="text-[24px] font-bold leading-tight text-ink">
              Budget private schools first.
            </h2>
            <p className="text-[16px] leading-relaxed text-graphite">
              Karnataka has 19,105 private unaided schools, where one teacher marks a pile of notebooks every night. Only
              8.2% of Karnataka students take private coaching, so the fix has to happen in school. The AI cost per
              student is measured on real calls; it&apos;s in the numbers above.
            </p>
            <p className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <External href="https://dashboard.udiseplus.gov.in/report-new-v.6-demo2025/static/media/UDISE+2024_25_Booklet_existing.118ba29d4773e6372f72.pdf">
                UDISE+ 2024-25
              </External>
              <External href="https://www.mospi.gov.in/uploads/publications_reports/publications_reports1757588642898_9ba30fe0-3677-478c-8d53-9a0d2ba107f0_CMS_E_2025L.pdf">
                MoSPI education survey 2025
              </External>
            </p>
          </div>
          <div className="gg-panel flex flex-col gap-3 border-l-4 border-l-red-pen p-6">
            <p className="font-hand text-[20px] text-red-pen">what we don&apos;t claim</p>
            <h2 className="text-[24px] font-bold leading-tight text-ink">Built in 24 hours, and honest about it.</h2>
            <p className="text-[16px] leading-relaxed text-graphite">
              We haven&apos;t run a classroom trial and have no users yet. The 30 students in class 7B are simulated, and
              Asha is a demo student. What we can show is that the whole loop works, live, and how accurate each part is.
            </p>
            <External href={SITE.repo} className="mt-auto text-[15px]">
              Read the code and the evaluation
            </External>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
