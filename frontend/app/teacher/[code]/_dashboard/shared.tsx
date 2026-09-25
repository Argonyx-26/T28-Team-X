import type { ReactNode } from "react";

import type { Telemetry } from "./api";
import s from "./dashboard.module.css";

export type Band = "green" | "amber" | "red" | "none";

export function band(value: number | null | undefined): Band {
  if (value === null || value === undefined) return "none";
  if (value >= 0.7) return "green";
  if (value >= 0.4) return "amber";
  return "red";
}

export const BAND_COLOR: Record<Band, string> = {
  green: "var(--green)",
  amber: "var(--amber)",
  red: "var(--red)",
  none: "#dfe4ec",
};

export const BAND_ICON: Record<Band, string> = { green: "✓", amber: "~", red: "!", none: "" };

export const BAND_WORDS: Record<Band, string> = {
  green: "secure",
  amber: "practising",
  red: "gap",
  none: "not assessed yet",
};

export const AGENTS: Record<string, { letter: string; color: string; verb: Record<string, string> }> = {
  Examiner: {
    letter: "E",
    color: "#3e4c85",
    verb: {
      select_question: "chose a question",
      retry: "graded the retry",
      gap_closed: "closed a gap",
      join: "welcomed a student",
    },
  },
  Diagnostician: {
    letter: "D",
    color: "#7a4fa3",
    verb: { diagnose: "diagnosed an answer", diagnose_photo: "read a notebook" },
  },
  Curator: { letter: "Cu", color: "#2f7f8a", verb: { lesson: "prepared a lesson" } },
  Analyst: {
    letter: "A",
    color: "#c8372d",
    verb: {
      analyze_class: "analysed the class",
      challenge: "sent a plan back",
      accept: "accepted a plan",
      flag_for_teacher: "flagged a plan for you",
    },
  },
  Coach: {
    letter: "C",
    color: "#b7791f",
    verb: {
      propose: "drafted a plan",
      revise: "revised the plan",
      parent_message: "wrote to a parent",
      voice_note: "recorded a voice note",
    },
  },
  Simulator: { letter: "S", color: "#8a8f99", verb: { simulate: "filled the practice class" } },
  Teacher: { letter: "T", color: "#1f2b5c", verb: { approve: "approved a plan" } },
};

export function agentVerb(agent: string, action: string): string {
  return AGENTS[agent]?.verb[action] ?? action.replaceAll("_", " ");
}

export function Avatar({ agent }: { agent: string }) {
  const meta = AGENTS[agent] ?? { letter: agent[0] ?? "?", color: "#8a8f99" };
  return (
    <span className={s.avatar} style={{ background: meta.color }} aria-hidden>
      {meta.letter}
    </span>
  );
}

const PROVIDER_NAMES: Record<string, string> = { vertex: "Gemini", nebius: "Nebius", "google-tts": "Google TTS" };

function shortModel(model: string): string {
  return model
    .replace(/^.*\//, "")
    .replace(/-preview$/, "")
    .replace(/^gemini-/, "")
    .replace(/-Instruct.*$/i, "")
    .replace(/^(kn|hi|en)-IN-Chirp3-HD-/, "Chirp 3 ");
}

export function TelemetryChip({ t }: { t: Telemetry }) {
  const provider = PROVIDER_NAMES[t.provider] ?? t.provider;
  const time = t.cached ? "cached" : `${(t.ms / 1000).toFixed(1)} s`;
  const cost = t.cost_paise > 0 ? `₹${(t.cost_paise / 100).toFixed(2)}` : null;
  return (
    <span className={s.chip} title={`${t.in_tokens} in / ${t.out_tokens} out${t.fallback ? ", fallback" : ""}`}>
      <strong style={{ color: t.ok ? "var(--ink-2)" : "var(--red-pen)" }}>{provider}</strong>
      <span>{shortModel(t.model)}</span>
      <span>{t.ok ? time : "failed"}</span>
      {cost && <span>{cost}</span>}
    </span>
  );
}

/** Puts a highlighter stroke behind "k of n" so the Analyst's numbers read at a glance. */
export function withNumbers(text: string): ReactNode[] {
  return text.split(/(\d+ of \d+)/g).map((part, i) =>
    /^\d+ of \d+$/.test(part) ? (
      <span key={i} className={s.highlight}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function isIndic(text: string): "kn" | "hi" | null {
  if (/[ಀ-೿]/.test(text)) return "kn";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  return null;
}
