"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, type Worksheet, api } from "../../_dashboard/api";
import s from "../../_dashboard/dashboard.module.css";
import { fontVars } from "../../_dashboard/fonts";
import k from "./sheet.module.css";

export function Sheet({ code, concept, tag }: { code: string; concept: string; tag: string }) {
  const [sheet, setSheet] = useState<Worksheet | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await api.lookup(code);
        const w = await api.worksheet(session.session_id, concept, tag);
        if (live) setSheet(w);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.message : "Couldn't load the worksheet.");
      }
    })();
    return () => {
      live = false;
    };
  }, [code, concept, tag]);

  return (
    <main className={`${s.root} ${fontVars} ${k.printRoot} min-h-dvh px-4 py-6`}>
      <div className={`${k.noPrint} mx-auto mb-4 flex max-w-[780px] items-center justify-between gap-2`}>
        <Link className={s.button} href={`/teacher/${encodeURIComponent(code)}`}>
          Back to the dashboard
        </Link>
        <button type="button" className={`${s.button} ${s.primary}`} onClick={() => window.print()} disabled={!sheet}>
          Print worksheet
        </button>
      </div>
      {error && <p className="mx-auto max-w-[780px]">{error}</p>}
      {sheet && (
        <article className={k.page}>
          <header className="mb-4 flex items-baseline justify-between gap-3 border-b border-[#d6dde9] pb-3">
            <div>
              <h1 className="text-[1.4em] font-bold">{sheet.concept_name}</h1>
              <p className={s.muted}>
                {sheet.class_name} · for students who {sheet.label}
              </p>
            </div>
            <span className={`${s.hand} text-[1.3em]`}>GuruGraph</span>
          </header>
          <p className="mb-1">
            Name: <span className="inline-block w-56 border-b border-[#9aa3b2]">&nbsp;</span>
          </p>
          {sheet.students.length > 0 && (
            <p className={`${s.muted} mb-4 text-[0.85em]`}>Group: {sheet.students.join(", ")}</p>
          )}

          <section className="mb-5">
            <h2 className="mb-1 font-semibold">Remember</h2>
            <p className={`${s.hand} text-[1.15em]`}>{sheet.worked_example}</p>
          </section>

          {sheet.spot_the_mistake && (
            <section className="mb-5">
              <h2 className="mb-1 font-semibold">Spot the mistake</h2>
              <p>
                A student wrote <span className={`${s.hand} text-[1.15em]`}>{sheet.spot_the_mistake.student_answer}</span>{" "}
                for <span className={s.hand}>{sheet.spot_the_mistake.question}</span>. What went wrong? Write the right
                answer.
              </p>
              <span className={k.line} />
              <span className={k.line} />
            </section>
          )}

          <section>
            <h2 className="mb-2 font-semibold">Practise</h2>
            <ol className="flex list-decimal flex-col gap-3 pl-6">
              {sheet.items.map((item, i) => (
                <li key={i}>
                  <span className={`${s.hand} text-[1.1em]`}>{item.question}</span>
                  <span className={k.line} />
                </li>
              ))}
            </ol>
          </section>

          <div className={k.cut}>✂ Answer key for the teacher</div>
          <ol className="grid list-decimal grid-cols-3 gap-x-6 pl-6 text-[0.9em]">
            {sheet.items.map((item, i) => (
              <li key={i} className={s.hand}>
                {item.answer}
              </li>
            ))}
          </ol>
        </article>
      )}
    </main>
  );
}
