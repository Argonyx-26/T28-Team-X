"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { AgentEvent } from "./api";
import s from "./dashboard.module.css";
import { Avatar, TelemetryChip, agentVerb, isIndic, withNumbers } from "./shared";

function time(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AgentFeed({ events }: { events: AgentEvent[] }) {
  const reduce = useReducedMotion();
  if (events.length === 0) {
    return (
      <p className={`${s.muted} p-2`}>
        Nothing yet. When a student answers or you scan a notebook, the agents&apos; work shows up here.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-1.5" aria-live="polite" aria-label="Agent activity, newest first">
      <AnimatePresence initial={false}>
        {events.map((e) => {
          const challenge = e.action === "challenge" || e.action === "flag_for_teacher";
          const accepted = e.action === "accept" || e.action === "gap_closed" || e.action === "approve";
          const indic = isIndic(e.reason);
          return (
            <motion.li
              key={e.seq}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`${s.feedItem} ${challenge ? s.challenge : ""} ${accepted ? s.accepted : ""} flex gap-2.5`}
            >
              <Avatar agent={e.agent} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    <strong>{e.agent}</strong> <span className={s.muted}>{agentVerb(e.agent, e.action)}</span>
                  </span>
                  <span className={`${s.muted} shrink-0 text-[0.78em]`}>{time(e.ts)}</span>
                </div>
                <p className={`mt-0.5 break-words text-[0.92em] leading-snug ${indic === "kn" ? s.kn : ""}`}>
                  {challenge && (
                    <span className={`${s.hand} mr-1`} style={{ color: "var(--red-pen)" }}>
                      No:
                    </span>
                  )}
                  {withNumbers(e.reason)}
                </p>
                {e.telemetry.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.telemetry.map((t, i) => (
                      <TelemetryChip key={i} t={t} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-1">
                    <span className={s.chip}>rules, no AI call</span>
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
