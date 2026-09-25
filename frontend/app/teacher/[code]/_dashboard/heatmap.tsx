"use client";

import type { ConceptStat, Dashboard } from "./api";
import s from "./dashboard.module.css";
import { BAND_COLOR, BAND_ICON, BAND_WORDS, band } from "./shared";

export function Heatmap({
  data,
  concepts,
  selected,
  onSelect,
  projector,
}: {
  data: Dashboard["heatmap"];
  concepts: ConceptStat[];
  selected: string | null;
  onSelect: (studentId: string) => void;
  projector: boolean;
}) {
  const names = Object.fromEntries(concepts.map((c) => [c.id, c]));
  const rows = data.students.map((student, i) => ({ student, cells: data.cells[i] }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <table className="w-full border-separate" style={{ borderSpacing: "0 3px" }}>
          <caption className="sr-only">Mastery of each student on each concept</caption>
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <th scope="col" className="pb-2 text-left align-bottom font-medium">
                <span className={s.muted}>Student</span>
              </th>
              {data.concept_ids.map((cid) => (
                <th key={cid} scope="col" className="px-[3px] pb-2 align-bottom text-[0.8em] font-medium">
                  <span className={s.rotated} title={names[cid]?.name}>
                    {names[cid]?.short ?? cid}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, cells }) => (
              <tr
                key={student.id}
                tabIndex={0}
                aria-label={`Open ${student.nickname}`}
                className={`${s.row} ${s.focusable} ${selected === student.id ? s.rowSelected : ""} cursor-pointer`}
                onClick={() => onSelect(student.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(student.id);
                  }
                }}
              >
                <th scope="row" className="max-w-[9rem] truncate py-[1px] pl-2 pr-3 text-left font-normal">
                  {student.kind === "demo" ? (
                    <span className="font-semibold" style={{ color: "var(--red-pen)" }}>
                      ★ {student.nickname}
                    </span>
                  ) : (
                    <span className={student.kind === "simulated" ? s.muted : "font-medium"}>{student.nickname}</span>
                  )}
                  {student.kind === "simulated" && <span className="ml-1 text-[0.72em] text-[#616874]">sim</span>}
                </th>
                {cells.map((value, j) => {
                  const b = band(value);
                  const concept = names[data.concept_ids[j]];
                  const label = `${student.nickname}, ${concept?.name}: ${
                    value === null ? "not assessed yet" : `${Math.round(value * 100)} (${BAND_WORDS[b]})`
                  }`;
                  return (
                    <td key={j} className="px-[3px] py-0">
                      <div
                        className={`${s.cell} ${b === "none" ? s.cellEmpty : ""}`}
                        style={{ background: b === "none" ? undefined : BAND_COLOR[b], transition: "background 500ms" }}
                        title={label}
                        role="img"
                        aria-label={label}
                      >
                        {projector ? BAND_ICON[b] : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8em]" aria-hidden>
        {(["green", "amber", "red", "none"] as const).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span
              className={`${s.cell} ${b === "none" ? s.cellEmpty : ""}`}
              style={{
                width: 14,
                height: 14,
                fontSize: 9,
                borderRadius: 3,
                background: b === "none" ? undefined : BAND_COLOR[b],
              }}
            >
              {projector ? BAND_ICON[b] : ""}
            </span>
            <span className={s.muted}>{BAND_WORDS[b]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
