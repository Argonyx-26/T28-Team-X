"use client";

import { useEffect, useRef, useState } from "react";

import { FLAGS } from "@/lib/flags";

import { API_BASE, ApiError, type Lang, api } from "../../../teacher/[code]/_dashboard/api";
import k from "./student.module.css";
import { type Words, errorText } from "./words";

// one audio URL per (language, text), so a second tap replays without another request
const voices = new Map<string, string>();

/** The lesson markdown as words to read aloud: no `*`, `#`, list bullets or backticks. */
export function speakable(md: string): string {
  return md
    .replace(/[*#`_>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1200);
}

type State = { name: "idle" } | { name: "loading" } | { name: "playing" } | { name: "error"; text: string };

/**
 * F9: reads a piece of text aloud (POST /media/speak). The <audio> element is created inside the tap, so iOS
 * lets it play after the fetch. Hidden unless FLAGS.LISTEN is on.
 */
export function Listen({ text, language, words, label }: { text: string; language: Lang; words: Words; label?: string }) {
  const [state, setState] = useState<State>({ name: "idle" });
  const audio = useRef<HTMLAudioElement | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      audio.current?.pause();
      audio.current = null;
    };
  }, []);

  if (!FLAGS.LISTEN || !text.trim()) return null;

  function stop() {
    audio.current?.pause();
    audio.current = null;
    setState({ name: "idle" });
  }

  async function play() {
    if (state.name === "playing") {
      stop();
      return;
    }
    // created inside the user gesture: iOS Safari only plays audio an interaction unlocked
    const el = new Audio();
    el.preload = "auto";
    el.play().catch(() => {
      // no source yet; this only unlocks the element
    });
    audio.current = el;
    el.onended = () => {
      if (live.current && audio.current === el) setState({ name: "idle" });
    };
    el.onerror = () => {
      if (live.current && audio.current === el) setState({ name: "error", text: words.listenError });
    };
    setState({ name: "loading" });
    const key = `${language}:${text}`;
    try {
      let url = voices.get(key);
      if (!url) {
        const r = await api.speak(text, language);
        url = `${API_BASE}${r.audio_url}`;
        voices.set(key, url);
      }
      if (!live.current || audio.current !== el) return;
      el.src = url;
      await el.play();
      if (live.current && audio.current === el) setState({ name: "playing" });
    } catch (e) {
      if (!live.current) return;
      audio.current = null;
      setState({
        name: "error",
        text: e instanceof ApiError ? errorText(words, e.code, words.listenError) : words.listenError,
      });
    }
  }

  const playing = state.name === "playing";
  const loading = state.name === "loading";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={`${k.listen} ${playing ? k.listenOn : ""}`}
        aria-label={label ? `${playing ? words.stop : words.listen}: ${label}` : undefined}
        aria-pressed={playing}
        aria-busy={loading}
        disabled={loading}
        onClick={() => void play()}
      >
        <span aria-hidden>{playing ? "■" : loading ? "…" : "▶"}</span>
        {playing ? words.stop : words.listen}
      </button>
      {state.name === "error" && (
        <span role="alert" className="text-[0.9em]" style={{ color: "var(--red-pen)" }}>
          {state.text}
        </span>
      )}
    </span>
  );
}
