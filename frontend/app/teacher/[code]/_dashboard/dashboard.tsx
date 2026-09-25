"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { type AgentEvent, ApiError, type Dashboard as DashboardData, type SessionLookup, api } from "./api";
import s from "./dashboard.module.css";
import { DebatePanel } from "./debate";
import { AgentFeed } from "./feed";
import { fontVars } from "./fonts";
import { KnowledgeGraph } from "./graph";
import { Heatmap } from "./heatmap";
import { StudentSheet } from "./student-sheet";

const DASHBOARD_MS = 2000;
const EVENTS_MS = 1500;
const FEED_LIMIT = 60;

/** Runs `fn` now and then every `ms` while the tab is visible. The latest `fn` is always used. */
function usePoll(fn: () => Promise<void>, ms: number, enabled: boolean) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await latest.current().catch(() => undefined);
      if (!stopped) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ms, enabled]);
}

function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${s.sheet} flex min-h-0 flex-col p-4 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className={s.sheetTitle}>{title}</h2>
        {note && <span className={`${s.muted} text-[0.8em]`}>{note}</span>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function joinUrl(code: string): string {
  return typeof window === "undefined" ? `/join/${code}` : `${window.location.origin}/join/${code}`;
}

function JoinDialog({ code, open, onOpenChange }: { code: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${s.root} ${fontVars} sm:max-w-md`}>
        <DialogHeader>
          <DialogTitle className="text-[1.3em] text-[var(--ink)]">Join class {code}</DialogTitle>
          <DialogDescription className="text-[var(--graphite)]">
            Students scan this with their phone, or open the link and pick their language.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="rounded-2xl border border-[var(--rule)] bg-white p-4">
            <QRCodeSVG value={joinUrl(code)} size={240} fgColor="#1f2b5c" />
          </div>
          <div className={`${s.hand} text-[2.4em] leading-none`}>{code}</div>
          <div className={`${s.muted} break-all text-center text-[0.9em]`}>{joinUrl(code)}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GapMeter({ data }: { data: DashboardData }) {
  const { open, closed } = data.gaps;
  const total = open + closed;
  const focus = data.concepts.find((c) => c.id === data.focus_concept);
  const groups = [
    ["Re-teach", data.groups.reteach.length, "var(--red)"],
    ["Practise", data.groups.practice.length, "var(--amber)"],
    ["Extend", data.groups.extend.length, "var(--green)"],
    ["Not assessed yet", data.groups.not_assessed.length, "#9aa3b2"],
  ] as const;
  return (
    <footer className={`${s.sheet} flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:gap-8`}>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="shrink-0 text-[1.05em]">
          Gaps closed this session:{" "}
          <strong className={`${s.highlight} text-[1.2em]`}>
            {closed} of {total}
          </strong>
        </div>
        <div
          className={`${s.meterTrack} min-w-[120px] flex-1`}
          role="progressbar"
          aria-valuenow={closed}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Gaps closed"
        >
          <div className={s.meterFill} style={{ width: `${total ? (closed / total) * 100 : 0}%` }} />
        </div>
      </div>
      {focus && (
        <div className="flex flex-wrap items-center gap-2 text-[0.92em]">
          <span className={s.muted}>On {focus.name.toLowerCase()}:</span>
          {groups.map(([label, n, color]) => (
            <span key={label} className={s.chip} style={{ fontSize: "0.85em", lineHeight: "24px" }}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              <span style={{ color: "var(--ink)" }}>
                {label} <strong>{n}</strong>
              </span>
            </span>
          ))}
        </div>
      )}
    </footer>
  );
}

function Skeleton() {
  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[0.95fr_1.3fr_1fr]" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${s.sheet} min-h-[320px] animate-pulse`} />
      ))}
    </div>
  );
}

export function Dashboard({ code }: { code: string }) {
  const [session, setSession] = useState<SessionLookup | null>(null);
  const [notFound, setNotFound] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [projector, setProjector] = useState(false);
  const [student, setStudent] = useState<string | null>(null);
  const [debateOpen, setDebateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    let live = true;
    api
      .lookup(code)
      .then((found) => live && setSession(found))
      .catch((e) => live && setNotFound(e instanceof ApiError ? e.message : "Couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [code]);

  const loadDashboard = useCallback(async () => {
    if (!session) return;
    try {
      setData(await api.dashboard(session.session_id));
      setReconnecting(false);
    } catch {
      setReconnecting(true);
    }
  }, [session]);

  const loadEvents = useCallback(async () => {
    if (!session) return;
    const r = await api.events(session.session_id, lastSeq.current);
    if (r.events.length) {
      lastSeq.current = r.last_seq;
      setEvents((old) => [...r.events.slice().reverse(), ...old].slice(0, FEED_LIMIT));
    }
  }, [session]);

  usePoll(loadDashboard, DASHBOARD_MS, session !== null);
  usePoll(loadEvents, EVENTS_MS, session !== null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && !e.altKey) setProjector((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rootClass = `${s.root} ${fontVars} ${projector ? s.projector : ""}`;

  if (notFound) {
    return (
      <main className={`${rootClass} grid place-items-center p-6`}>
        <div className={`${s.sheet} max-w-md p-6 text-center`}>
          <h1 className="text-[1.3em] font-semibold">No class called {code}</h1>
          <p className={`${s.muted} mt-2`}>{notFound}</p>
        </div>
      </main>
    );
  }

  const simulatedNote = data && data.n_simulated > 0 ? `, ${data.n_simulated} of them simulated for practice` : "";

  return (
    <main className={`${rootClass} flex flex-col gap-4 p-4 lg:h-dvh lg:p-5`}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-4">
          <span className={`${s.hand} text-[1.9em] font-bold leading-none`}>GuruGraph</span>
          <div>
            <h1 className="text-[1.15em] font-semibold leading-tight">{session?.class_name ?? "Loading class…"}</h1>
            <p className={`${s.muted} text-[0.88em]`}>
              {data ? `${data.n_students} students${simulatedNote}` : " "}
              {reconnecting && (
                <span className="ml-2 rounded-full bg-[#fdf3f2] px-2 py-0.5" style={{ color: "var(--red-pen)" }}>
                  Reconnecting…
                </span>
              )}
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Class actions">
          <button type="button" className={s.button} onClick={() => setJoinOpen(true)}>
            Join code <strong className={`${s.hand} text-[1.2em]`}>{code}</strong>
          </button>
          <Link className={s.button} href={`/teacher/${encodeURIComponent(code)}/scan`}>
            Scan a notebook
          </Link>
          <Link className={s.button} href={`/teacher/${encodeURIComponent(code)}/pile`}>
            Read a pile
          </Link>
          <button
            type="button"
            className={s.button}
            aria-pressed={projector}
            onClick={() => setProjector((p) => !p)}
            title="Press P to switch"
          >
            {projector ? "Leave projector view" : "Projector view"}
          </button>
          <button
            type="button"
            className={`${s.button} ${s.primary}`}
            disabled={!session}
            onClick={() => setDebateOpen(true)}
          >
            Plan tomorrow&apos;s lesson
          </button>
        </nav>
      </header>

      {!data ? (
        <Skeleton />
      ) : data.n_students === 0 ? (
        <div className={`${s.sheet} flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center`}>
          <h2 className="text-[1.4em] font-semibold">No students yet</h2>
          <p className={s.muted}>Put the join code on the board. Answers appear here as they come in.</p>
          <div className="rounded-2xl border border-[var(--rule)] bg-white p-4">
            <QRCodeSVG value={joinUrl(code)} size={200} fgColor="#1f2b5c" />
          </div>
          <div className={`${s.hand} text-[2em]`}>{code}</div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,0.95fr)_minmax(420px,1.3fr)_minmax(320px,1fr)]">
          <Panel title="What the class knows" note="class average per concept">
            <KnowledgeGraph
              concepts={data.concepts}
              edges={data.edges}
              focus={data.focus_concept}
              projector={projector}
            />
          </Panel>
          <Panel title="Who is stuck where" note="tap a student" className="max-h-[70vh] lg:max-h-none">
            <Heatmap
              data={data.heatmap}
              concepts={data.concepts}
              selected={student}
              onSelect={setStudent}
              projector={projector}
            />
          </Panel>
          <Panel title="What the agents are doing" note="live" className="max-h-[70vh] lg:max-h-none">
            <div className="h-full overflow-y-auto pr-1">
              <AgentFeed events={events} />
            </div>
          </Panel>
        </div>
      )}

      {data && data.n_students > 0 && <GapMeter data={data} />}

      {session && (
        <DebatePanel
          sessionId={session.session_id}
          open={debateOpen}
          onOpenChange={setDebateOpen}
          onChanged={() => void loadDashboard()}
        />
      )}
      <StudentSheet
        studentId={student}
        concepts={data?.concepts ?? []}
        onOpenChange={(open) => !open && setStudent(null)}
      />
      <JoinDialog code={code} open={joinOpen} onOpenChange={setJoinOpen} />
    </main>
  );
}
