"use client";

import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { API_BASE, ApiError, type ConceptStat, type ParentMessage, type StudentDetail, admin, adminToken, api } from "./api";
import s from "./dashboard.module.css";
import { fontVars } from "./fonts";
import { BAND_COLOR, BAND_WORDS, TelemetryChip, band, isIndic } from "./shared";

const LANG_NAMES: Record<string, string> = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ" };
const KIND_NOTE: Record<string, string> = {
  simulated: "Simulated student in the practice class",
  demo: "Demo student",
  real: "Joined with a class code",
};

function ParentMessageCard({ studentId }: { studentId: string }) {
  const [msg, setMsg] = useState<ParentMessage | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [copied, setCopied] = useState(false);

  async function write() {
    setState("loading");
    try {
      setMsg(await api.parentMessage(studentId));
      setState("idle");
    } catch (e) {
      setState("error");
      console.error(e instanceof ApiError ? e.message : e);
    }
  }

  if (!msg) {
    return (
      <div>
        <button
          type="button"
          className={`${s.button} ${s.primary}`}
          disabled={state === "loading"}
          onClick={() => void write()}
        >
          {state === "loading" ? "Writing to the parent…" : "Message the parent"}
        </button>
        {state === "error" && (
          <p className="mt-2 text-[0.9em]" style={{ color: "var(--red-pen)" }}>
            The message couldn&apos;t be written. Try again.
          </p>
        )}
      </div>
    );
  }

  const lang = isIndic(msg.message);
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`max-w-[92%] self-start rounded-2xl rounded-tl-sm border border-[#cfe9d6] bg-[#e7f7ec] px-3.5 py-2.5 ${lang === "kn" ? s.kn : ""}`}
      >
        {msg.message}
      </div>
      {msg.audio_url && (
        <div className="flex items-center gap-2">
          <span className={`${s.muted} text-[0.85em]`}>Voice note in {LANG_NAMES[msg.language] ?? msg.language}</span>
          <audio controls preload="none" src={`${API_BASE}${msg.audio_url}`} className="h-9 max-w-full" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <a className={`${s.button} ${s.primary}`} href={msg.whatsapp_url} target="_blank" rel="noreferrer">
          Open in WhatsApp
        </a>
        <button
          type="button"
          className={s.button}
          onClick={() => {
            void navigator.clipboard.writeText(msg.message).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy text"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {msg.telemetry.map((t, i) => (
          <TelemetryChip key={i} t={t} />
        ))}
      </div>
    </div>
  );
}

export function StudentSheet({
  studentId,
  concepts,
  onOpenChange,
  onRemoved,
}: {
  studentId: string | null;
  concepts: ConceptStat[];
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}) {
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<"" | "confirm" | "busy" | "failed">("");
  const canRemove = adminToken.get().length > 0;

  async function remove(id: string) {
    setRemoving("busy");
    try {
      await admin.removeStudent(id);
      onRemoved?.();
      onOpenChange(false);
      setRemoving("");
    } catch {
      setRemoving("failed");
    }
  }

  useEffect(() => {
    if (!studentId) return;
    let live = true;
    api
      .student(studentId)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Couldn't load this student."));
    return () => {
      live = false;
    };
  }, [studentId]);

  const current = detail && detail.id === studentId ? detail : null;
  const openGaps = current?.gaps.filter((g) => g.status === "open") ?? [];

  return (
    <Sheet open={studentId !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`${s.root} ${fontVars} data-[side=right]:w-full data-[side=right]:sm:max-w-[460px] gap-0 overflow-y-auto p-0`}
      >
        <SheetHeader className="border-b border-[var(--rule)] bg-white/90 px-5 py-4">
          <SheetTitle className="text-[1.3em] font-semibold text-[var(--ink)]">
            {current?.nickname ?? "Loading…"}
          </SheetTitle>
          <SheetDescription className="text-[var(--graphite)]">
            {current ? `${KIND_NOTE[current.kind] ?? ""}. Learns in ${LANG_NAMES[current.language]}.` : " "}
          </SheetDescription>
        </SheetHeader>

        {error && !current && <p className="px-5 py-4">{error}</p>}

        {current && (
          <div className="flex flex-col gap-5 px-5 py-5">
            <section aria-label="Mastery by concept">
              <h3 className="mb-2 font-semibold">Where {current.nickname} is</h3>
              <ul className="flex flex-col gap-1.5">
                {concepts.map((c) => {
                  const assessed = current.assessed.includes(c.id);
                  const value = assessed ? (current.mastery[c.id] ?? null) : null;
                  const b = band(value);
                  return (
                    <li key={c.id} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2 text-[0.9em]">
                      <span className="truncate">{c.short}</span>
                      <span className={s.meterTrack} aria-hidden>
                        <span
                          className={s.meterFill}
                          style={{ display: "block", width: `${(value ?? 0) * 100}%`, background: BAND_COLOR[b] }}
                        />
                      </span>
                      <span className={`${s.muted} text-right`} title={BAND_WORDS[b]}>
                        {value === null ? "–" : Math.round(value * 100)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section aria-label="Open gaps">
              <h3 className="mb-2 font-semibold">Open gaps</h3>
              {openGaps.length === 0 ? (
                <p className={s.muted}>None right now.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {openGaps.map((g) => (
                    <li key={g.concept_id} className={`${s.feedItem} ${s.challenge}`}>
                      <strong>{concepts.find((c) => c.id === g.concept_id)?.name}</strong>
                      <div className={s.hand} style={{ color: "var(--red-pen)" }}>
                        {g.label}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Recent answers">
              <h3 className="mb-2 font-semibold">Recent answers</h3>
              <ul className="flex flex-col divide-y divide-[var(--rule)] text-[0.9em]">
                {current.responses.slice(0, 8).map((r, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                    <span>
                      {r.stem} <span className={`${s.hand} ml-1`}>{r.answer}</span>
                      {!r.correct && r.label && (
                        <span className="block text-[0.9em]" style={{ color: "var(--red-pen)" }}>
                          {r.label}
                        </span>
                      )}
                    </span>
                    <span style={{ color: r.correct ? "var(--green)" : "var(--red-pen)" }} aria-label={r.correct ? "right" : "wrong"}>
                      {r.correct ? "✓" : "✗"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Parent message">
              <h3 className="mb-2 font-semibold">Tell the family</h3>
              <ParentMessageCard key={current.id} studentId={current.id} />
            </section>

            {canRemove && current.kind === "real" && (
              <section aria-label="Remove student" className="border-t border-dashed border-[var(--rule)] pt-4">
                {removing === "confirm" || removing === "busy" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9em]">Remove {current.nickname} and their answers from the class?</span>
                    <button type="button" className={`${s.button} ${s.primary}`} disabled={removing === "busy"} onClick={() => void remove(current.id)}>
                      {removing === "busy" ? "Removing…" : "Yes, remove"}
                    </button>
                    <button type="button" className={s.button} disabled={removing === "busy"} onClick={() => setRemoving("")}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <button type="button" className={`${s.button} text-[0.9em]`} onClick={() => setRemoving("confirm")}>
                    Remove from the class
                  </button>
                )}
                {removing === "failed" && (
                  <p className="mt-1 text-[0.9em]" style={{ color: "var(--red-pen)" }}>
                    Couldn&apos;t remove them. Check the admin token on /present.
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
