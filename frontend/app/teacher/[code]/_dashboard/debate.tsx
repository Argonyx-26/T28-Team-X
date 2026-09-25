"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { type AnalyzeResponse, type AnalyzeStep, ApiError, type Recommendation, api } from "./api";
import s from "./dashboard.module.css";
import { fontVars } from "./fonts";
import { Avatar, TelemetryChip, withNumbers } from "./shared";

const AUDIENCE: Record<string, string> = {
  whole_class: "Whole class",
  reteach_group: "Re-teach group",
  practice_group: "Practice group",
  extend_group: "Extension group",
  individuals: "Individual students",
};

const BEAT_MS = 900;

function PlanCard({ rec, stage }: { rec: Recommendation; stage: "Draft" | "Revised" | "Final" }) {
  return (
    <div className={`${s.sheet} p-4`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[0.8em]">
        <span className={`${s.hand} text-[1.15em]`} style={{ color: stage === "Draft" ? "var(--graphite)" : "var(--ink-2)" }}>
          {stage}
        </span>
        <span className={s.chip}>
          {AUDIENCE[rec.audience] ?? rec.audience}, {rec.n_students} {rec.n_students === 1 ? "student" : "students"}
        </span>
        <span className={s.chip}>{rec.concept_name}</span>
      </div>
      <h4 className="font-semibold leading-snug">{rec.headline}</h4>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[0.93em]">
        {rec.plan_5min.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <div
        className={`${s.hand} mt-2 rounded-lg border border-[var(--rule)] px-3 py-1.5 text-[1.05em]`}
        style={{
          backgroundImage: "linear-gradient(transparent 27px, #e3e9f3 27px)",
          backgroundSize: "100% 28px",
          lineHeight: "28px",
        }}
      >
        {rec.worked_example}
      </div>
      <p className={`${s.muted} mt-2 text-[0.88em]`}>{withNumbers(rec.why)}</p>
    </div>
  );
}

function Beat({ step }: { step: AnalyzeStep }) {
  if (step.agent === "Analyst") {
    return (
      <div className="flex flex-col gap-2">
        {(step.critiques ?? []).map((c) => (
          <div
            key={c.index}
            className={`${s.feedItem} ${c.verdict === "revise" ? s.challenge : s.accepted} flex gap-2.5 bg-white`}
          >
            <Avatar agent="Analyst" />
            <div>
              <div className="font-semibold">
                {c.verdict === "revise" ? "Analyst sent plan " : "Analyst accepted plan "}
                {c.index + 1}
                {c.verdict === "revise" ? " back" : ""}
              </div>
              <p className="mt-0.5 text-[0.95em] leading-snug">{withNumbers(c.reason)}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar agent="Coach" />
        <span className="font-semibold">
          {step.action === "propose" ? "Coach drafted a plan from the mark book" : "Coach revised the plan"}
        </span>
      </div>
      {(step.recommendations ?? []).map((rec) => (
        <PlanCard key={rec.id} rec={rec} stage={step.action === "propose" ? "Draft" : "Revised"} />
      ))}
    </div>
  );
}

export function DebatePanel({
  sessionId,
  open,
  onOpenChange,
  onChanged,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const reduce = useReducedMotion();
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [shown, setShown] = useState(0);
  const [approved, setApproved] = useState<Record<string, "saving" | "done">>({});

  async function run() {
    setStatus("loading");
    setResult(null);
    setShown(0);
    setApproved({});
    try {
      const r = await api.analyze(sessionId);
      setResult(r);
      setShown(reduce ? r.steps.length + 1 : 1);
      setStatus("done");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The agents couldn't finish. Try again.");
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!open || status !== "idle") return;
    // opening the panel starts the analysis; this is the one place that kicks it off
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!result || reduce) return;
    // the debate plays out one beat at a time, like a conversation
    const total = result.steps.length + 1;
    const timer = setInterval(() => setShown((n) => (n >= total ? n : n + 1)), BEAT_MS);
    return () => clearInterval(timer);
  }, [result, reduce]);

  async function approve(rec: Recommendation) {
    setApproved((a) => ({ ...a, [rec.id]: "saving" }));
    try {
      await api.approve(rec.id);
      setApproved((a) => ({ ...a, [rec.id]: "done" }));
      onChanged();
    } catch {
      setApproved((a) => {
        const next = { ...a };
        delete next[rec.id];
        return next;
      });
    }
  }

  const steps = result?.steps ?? [];
  const finished = result !== null && shown > steps.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`${s.root} ${fontVars} data-[side=right]:w-full data-[side=right]:sm:max-w-[600px] gap-0 overflow-y-auto p-0`}
      >
        <SheetHeader className="border-b border-[var(--rule)] bg-white/90 px-5 py-4">
          <SheetTitle className="text-[1.25em] font-semibold text-[var(--ink)]">Tomorrow&apos;s first five minutes</SheetTitle>
          <SheetDescription className="text-[var(--graphite)]">
            The Coach plans from the mark book. The Analyst checks every plan against each child&apos;s answers, and
            its rules decide.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-5 py-5">
          {status === "loading" && (
            <div className="flex flex-col gap-3" role="status">
              <div className="flex items-center gap-2.5 animate-pulse">
                <Avatar agent="Coach" /> Coach is drafting a plan…
              </div>
              <div className="flex items-center gap-2.5 animate-pulse [animation-delay:300ms]">
                <Avatar agent="Analyst" /> Analyst is checking it against every child&apos;s answers…
              </div>
            </div>
          )}

          {status === "error" && (
            <div className={`${s.feedItem} ${s.challenge}`}>
              <p>{error}</p>
              <button type="button" className={`${s.button} mt-2`} onClick={() => void run()}>
                Try again
              </button>
            </div>
          )}

          <AnimatePresence initial={false}>
            {steps.slice(0, shown).map((step, i) => (
              <motion.div
                key={`${step.agent}-${step.action}-${i}`}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <Beat step={step} />
              </motion.div>
            ))}
          </AnimatePresence>

          {finished && result && (
            <motion.section
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 flex flex-col gap-3 border-t border-dashed border-[var(--rule)] pt-4"
              aria-label="Final plans"
            >
              <h3 className="text-[1.1em] font-semibold">Your plan for tomorrow</h3>
              {result.final.map((rec) => (
                <div key={rec.id} className="flex flex-col gap-2">
                  {rec.flagged && (
                    <div className="rounded-lg border border-[var(--amber)] bg-[#fdf6e6] px-3 py-2 text-[0.92em]">
                      <strong>Needs your judgement.</strong> {rec.analyst_note}
                    </div>
                  )}
                  <PlanCard rec={rec} stage="Final" />
                  <div className="flex items-center gap-2">
                    {approved[rec.id] === "done" ? (
                      <span className="font-semibold" style={{ color: "var(--green)" }}>
                        ✓ Approved for tomorrow
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`${s.button} ${s.primary}`}
                        disabled={approved[rec.id] === "saving"}
                        onClick={() => void approve(rec)}
                      >
                        {approved[rec.id] === "saving" ? "Approving…" : "Approve plan"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 pt-1">
                {result.telemetry.map((t, i) => (
                  <TelemetryChip key={i} t={t} />
                ))}
              </div>
              <button type="button" className={`${s.button} self-start`} onClick={() => void run()}>
                Plan again
              </button>
            </motion.section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
