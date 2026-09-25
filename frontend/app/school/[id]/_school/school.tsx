"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, type SchoolSummary, api } from "../../../teacher/[code]/_dashboard/api";
import s from "../../../teacher/[code]/_dashboard/dashboard.module.css";
import { fontVars } from "../../../teacher/[code]/_dashboard/fonts";
import { BAND_COLOR, BAND_ICON, BAND_WORDS, band } from "../../../teacher/[code]/_dashboard/shared";

export function School({ id }: { id: string }) {
  const [data, setData] = useState<SchoolSummary | null>(null);
  const [error, setError] = useState("");
  const [projector, setProjector] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      api.school(id).then(
        (d) => {
          if (!live) return;
          setData(d);
          setError("");
        },
        (e: unknown) => live && setError(e instanceof ApiError ? e.message : "Can't reach the server. Check the connection."),
      );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);

  const worst = data
    ? data.classes.map((c) => ({ c, worst: Math.min(...Object.values(c.averages).map((v) => v ?? 1)) })).sort((a, b) => a.worst - b.worst)[0]?.c
    : null;

  return (
    <main className={`${s.root} ${fontVars} ${projector ? s.projector : ""} min-h-dvh`}>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 pb-12 pt-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Link href="/" className={`${s.hand} text-[1.6em] font-bold`}>
              GuruGraph
            </Link>
            <h1 className="text-[1.15em] font-semibold">School view · {id}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={s.button} aria-pressed={projector} onClick={() => setProjector((p) => !p)}>
              {projector ? "Leave projector view" : "Projector view"}
            </button>
            <Link className={s.button} href="/teacher/new">
              Add a class
            </Link>
          </div>
        </header>

        {error && (
          <div className={`${s.feedItem} ${s.challenge}`} role="alert">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="grid gap-4 md:grid-cols-2" aria-busy>
            <div className={`${s.sheet} h-64 animate-pulse`} />
            <div className={`${s.sheet} h-64 animate-pulse`} />
          </div>
        )}

        {data && (
          <>
            <p className={s.muted}>
              {data.n_classes} classes, {data.n_students} students. Every cell is a class average from each child&apos;s
              answers; the numbers are the same rules the class dashboard uses. Classes marked <em>sim</em> are simulated.
            </p>

            <section className={`${s.sheet} overflow-x-auto p-4`} aria-label="Classes by concept">
              <h2 className={`${s.sheetTitle} mb-3`}>Classes × concepts</h2>
              <table className="w-full border-separate" style={{ borderSpacing: "0 4px" }}>
                <caption className="sr-only">Average mastery of each class on each concept</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pb-2 text-left font-medium">
                      <span className={s.muted}>Class</span>
                    </th>
                    {data.concepts.map((c) => (
                      <th key={c.id} scope="col" className="px-1 pb-2 text-center text-[0.8em] font-medium" title={c.name}>
                        {c.short}
                      </th>
                    ))}
                    <th scope="col" className="pb-2 pl-3 text-left text-[0.8em] font-medium">
                      <span className={s.muted}>Open gaps</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.classes.map((c) => (
                    <tr key={c.session_id} className={s.row}>
                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                        <Link className="font-medium underline-offset-2 hover:underline" href={`/teacher/${encodeURIComponent(c.code)}`}>
                          {c.class_name}
                        </Link>
                        <span className={`${s.muted} ml-2 text-[0.8em]`}>{c.n_students} students{c.code !== "7B" && c.code.startsWith("7") && c.code.length === 2 ? " · sim" : ""}</span>
                      </th>
                      {data.concepts.map((k) => {
                        const v = c.averages[k.id];
                        const b = band(v);
                        const label = `${c.class_name}, ${k.name}: ${v === null || v === undefined ? "not assessed yet" : `${Math.round(v * 100)} (${BAND_WORDS[b]})`}`;
                        return (
                          <td key={k.id} className="px-1 py-0 text-center">
                            <div
                              className={`${s.cell} mx-auto ${b === "none" ? s.cellEmpty : ""}`}
                              style={{ width: 44, background: b === "none" ? undefined : BAND_COLOR[b], fontSize: 12 }}
                              role="img"
                              aria-label={label}
                              title={label}
                            >
                              {v === null || v === undefined ? "" : `${Math.round(v * 100)}${projector ? BAND_ICON[b] : ""}`}
                            </div>
                          </td>
                        );
                      })}
                      <td className="pl-3 text-[0.9em]">
                        <strong>{c.gaps.open}</strong> <span className={s.muted}>open, {c.gaps.closed} closed</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className={`${s.sheet} p-4`} aria-label="Top misconceptions across the school">
                <h2 className={`${s.sheetTitle} mb-3`}>Top mistakes across the school</h2>
                {data.top_misconceptions.length === 0 ? (
                  <p className={s.muted}>No mistakes recorded yet.</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {data.top_misconceptions.map((m, i) => (
                      <li key={m.tag} className="flex items-baseline gap-3">
                        <span className={`${s.hand} text-[1.3em]`} style={{ color: "var(--red-pen)" }}>
                          {i + 1}
                        </span>
                        <span>
                          <span className={s.hand} style={{ fontSize: "1.1em" }}>
                            {m.label}
                          </span>
                          <span className={`${s.muted} block text-[0.85em]`}>
                            <strong className={s.highlight}>{m.students} students</strong> across {m.concepts.map((id) => data.concepts.find((k) => k.id === id)?.name ?? id).join(", ").toLowerCase()}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className={`${s.sheet} p-4`} aria-label="Which class needs which re-teach">
                <h2 className={`${s.sheetTitle} mb-3`}>Which class needs which re-teach</h2>
                <ul className="flex flex-col gap-2">
                  {data.classes.map((c) => (
                    <li key={c.session_id} className={`${s.feedItem} ${c === worst ? s.challenge : ""}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <strong>{c.class_name}</strong>
                        {c.reteach ? (
                          <span className={`${s.muted} text-[0.85em]`}>{c.reteach.students} students</span>
                        ) : null}
                      </div>
                      {c.reteach ? (
                        <p className="mt-0.5 text-[0.95em]">
                          Re-teach <strong>{c.reteach.concept_name.toLowerCase()}</strong>:{" "}
                          <span className={s.hand} style={{ color: "var(--red-pen)" }}>
                            {c.reteach.label}
                          </span>
                        </p>
                      ) : (
                        <p className={`${s.muted} mt-0.5 text-[0.95em]`}>No gaps yet; nothing to re-teach.</p>
                      )}
                      <Link className={`${s.button} mt-2 min-h-9 text-[0.85em]`} href={`/teacher/${encodeURIComponent(c.code)}`}>
                        Open {c.code} and plan the lesson
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
