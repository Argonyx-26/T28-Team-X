"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import { track } from "@/lib/raah";

import { ApiError, type CreatedSession, api } from "../../[code]/_dashboard/api";
import s from "../../[code]/_dashboard/dashboard.module.css";
import { fontVars } from "../../[code]/_dashboard/fonts";

const EXAMPLE = "1, Asha, kn\n2, Ravi, hi\n3, Meena\n4, Kiran, kn";

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export function NewClass() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [school, setSchool] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedSession | null>(null);
  const [roster, setRoster] = useState("");
  const [rosterState, setRosterState] = useState<{ state: "idle" | "saving" | "done" | "error"; text?: string }>({
    state: "idle",
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.createSession(name.trim(), code.trim() || undefined, school.trim() || undefined);
      setCreated(r);
      track("class_created", { with_code: code.trim().length > 0 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server. Check the connection.");
    }
    setBusy(false);
  }

  async function importRoster() {
    if (!created || !roster.trim()) return;
    setRosterState({ state: "saving" });
    try {
      const r = await api.roster(created.session_id, roster);
      setRosterState({
        state: "done",
        text: `${r.added} student${r.added === 1 ? "" : "s"} added${r.updated ? `, ${r.updated} renamed` : ""}. Each has a roll number, so a page with "Roll 3" at the top files itself.`,
      });
      track("roster_imported", { added: r.added, updated: r.updated });
    } catch (err) {
      setRosterState({
        state: "error",
        text: err instanceof ApiError ? err.message : "The roster couldn't be saved. Check the connection.",
      });
    }
  }

  const joinUrl = created ? `${origin()}/join/${created.code}` : "";
  const teacherUrl = created ? `${origin()}/teacher/${created.code}` : "";

  return (
    <main className={`${s.root} ${fontVars} min-h-dvh`}>
      <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-4 pb-12 pt-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Link href="/" className={`${s.hand} text-[1.6em] font-bold`}>
              GuruGraph
            </Link>
            <span className={s.muted}>Create a class</span>
          </div>
          <Link className={s.button} href="/teacher/7B">
            Open the demo class
          </Link>
        </header>

        {!created ? (
          <form className={`${s.sheet} flex flex-col gap-4 p-5`} onSubmit={(e) => void create(e)} aria-label="New class">
            <h1 className="text-[1.4em] font-semibold">A class in one minute</h1>
            <p className={s.muted}>
              Name it, and you get a join code and QR for the children, and a teacher link for you. Then paste your
              roll list so homework pages file themselves.
            </p>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Class name</span>
              <input
                className={`${s.button} ${s.focusable} text-base`}
                value={name}
                maxLength={80}
                required
                placeholder="Class 6A · Fractions"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-medium">
                  Join code <span className={`${s.muted} font-normal`}>(optional; letters and digits)</span>
                </span>
                <input
                  className={`${s.button} ${s.focusable} text-base`}
                  value={code}
                  maxLength={12}
                  placeholder="6A"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">
                  School id <span className={`${s.muted} font-normal`}>(optional; groups classes on the school view)</span>
                </span>
                <input
                  className={`${s.button} ${s.focusable} text-base`}
                  value={school}
                  maxLength={40}
                  placeholder="demo"
                  onChange={(e) => setSchool(e.target.value)}
                />
              </label>
            </div>
            {error && (
              <p role="alert" style={{ color: "var(--red-pen)" }}>
                {error}
              </p>
            )}
            <button type="submit" className={`${s.button} ${s.primary} min-h-12 self-start`} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create the class"}
            </button>
          </form>
        ) : (
          <>
            <section className={`${s.sheet} flex flex-col gap-4 p-5`} aria-label="Your class is ready">
              <h1 className="text-[1.4em] font-semibold">{created.class_name} is ready</h1>
              <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="rounded-2xl border border-[var(--rule)] bg-white p-3">
                    <QRCodeSVG value={joinUrl} size={168} fgColor="#1f2b5c" />
                  </div>
                  <div className={`${s.hand} text-[2.2em] leading-none`}>{created.code}</div>
                </div>
                <dl className="flex flex-col gap-3 text-[0.95em]">
                  <div>
                    <dt className="font-semibold">For the children (and their parents)</dt>
                    <dd className="break-all">
                      <a className="underline" href={joinUrl}>
                        {joinUrl}
                      </a>
                      <span className={`${s.muted} block text-[0.9em]`}>They scan the code or open the link, type a nickname and pick a language. With the roll list below they can also type their roll number.</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">For you</dt>
                    <dd className="break-all">
                      <Link className="underline" href={`/teacher/${created.code}`}>
                        {teacherUrl}
                      </Link>
                      <span className={`${s.muted} block text-[0.9em]`}>The dashboard, the scan screen, the notebook pile and snap mode live here. Teacher pages have no login in this demo build.</span>
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className={`${s.sheet} flex flex-col gap-3 p-5`} aria-label="Roll list">
              <h2 className="text-[1.15em] font-semibold">Paste your roll list</h2>
              <p className={s.muted}>
                One child per line: <span className={s.hand}>roll, nickname</span>, and a language at the end if you
                like (en, hi, kn). Nicknames only; no surnames or phone numbers are needed.
              </p>
              <textarea
                className={`${s.button} ${s.focusable} min-h-[160px] w-full resize-y py-2 text-base`}
                value={roster}
                placeholder={EXAMPLE}
                aria-label="Roll list, one child per line"
                onChange={(e) => setRoster(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`${s.button} ${s.primary}`}
                  disabled={rosterState.state === "saving" || !roster.trim()}
                  onClick={() => void importRoster()}
                >
                  {rosterState.state === "saving" ? "Saving…" : "Import the roll list"}
                </button>
                <button type="button" className={s.button} onClick={() => setRoster(EXAMPLE)}>
                  Use the example
                </button>
              </div>
              {rosterState.text && (
                <p role={rosterState.state === "error" ? "alert" : "status"} style={{ color: rosterState.state === "error" ? "var(--red-pen)" : "var(--green)" }}>
                  {rosterState.state === "done" ? "✓ " : ""}
                  {rosterState.text}
                </p>
              )}
            </section>

            <div className="flex flex-wrap gap-2">
              <Link className={`${s.button} ${s.primary}`} href={`/teacher/${created.code}`}>
                Open the class dashboard
              </Link>
              <Link className={s.button} href={`/teacher/${created.code}/scan`}>
                Scan a notebook
              </Link>
              {school.trim() && (
                <Link className={s.button} href={`/school/${encodeURIComponent(school.trim())}`}>
                  School view
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
