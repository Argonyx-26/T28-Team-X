"use client";

import { useState } from "react";

import type { ConceptStat } from "./api";
import s from "./dashboard.module.css";
import { BAND_COLOR, BAND_ICON, BAND_WORDS, band } from "./shared";

const POS: Record<string, [number, number]> = {
  C1: [200, 60],
  C2: [100, 175],
  C3: [300, 175],
  C6: [100, 300],
  C4: [240, 305],
  C5: [350, 305],
  C7: [100, 420],
  C8: [240, 445],
};
const R = 30;

/** A slightly wobbly circle, like a ring drawn by hand with a red pen. */
function handRing(cx: number, cy: number, r: number, seed: number): string {
  const pts: string[] = [];
  const steps = 28;
  for (let i = 0; i <= steps + 2; i++) {
    const a = (i / steps) * Math.PI * 2 - 0.6;
    const wobble = 1 + 0.035 * Math.sin(i * 1.7 + seed) + 0.02 * Math.cos(i * 3.1 + seed * 2);
    const rr = r * wobble + (i > steps ? 2.5 : 0);
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

function edgePath(from: [number, number], to: [number, number]): string {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const sx = x1 + Math.cos(angle) * R;
  const sy = y1 + Math.sin(angle) * R;
  const ex = x2 - Math.cos(angle) * (R + 6);
  const ey = y2 - Math.sin(angle) * (R + 6);
  const mx = (sx + ex) / 2 + Math.sin(angle) * 14;
  const my = (sy + ey) / 2 - Math.cos(angle) * 14;
  return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

export function KnowledgeGraph({
  concepts,
  edges,
  focus,
  projector,
}: {
  concepts: ConceptStat[];
  edges: [string, string][];
  focus: string | null;
  projector: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));
  const shown = byId[selected ?? focus ?? ""] ?? null;

  return (
    <div className="flex h-full flex-col">
      <svg viewBox="0 0 400 520" className="w-full" role="img" aria-label="Knowledge graph of the 8 fraction concepts">
        <defs>
          <pattern id="gg-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#eef1f6" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#d3d9e3" strokeWidth="2" />
          </pattern>
          <marker id="gg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,1 L9,5 L0,9" fill="none" stroke="#9aa3b2" strokeWidth="1.6" />
          </marker>
        </defs>
        {edges.map(([a, b]) =>
          POS[a] && POS[b] ? (
            <path
              key={`${a}-${b}`}
              d={edgePath(POS[a], POS[b])}
              fill="none"
              stroke="#9aa3b2"
              strokeWidth="1.6"
              markerEnd="url(#gg-arrow)"
            />
          ) : null,
        )}
        {concepts.map((c, i) => {
          const pos = POS[c.id];
          if (!pos) return null;
          const [x, y] = pos;
          const b = band(c.avg);
          const isFocus = c.id === focus;
          const ring = handRing(x, y, R + 9, i + 1);
          return (
            <g
              key={c.id}
              tabIndex={0}
              role="button"
              aria-label={`${c.avg === null ? "–" : Math.round(c.avg * 100)} ${c.short}: ${c.name}, ${c.avg === null ? "not assessed yet" : `class average ${Math.round(c.avg * 100)}`}, ${c.open_gaps} open gaps`}
              className={s.focusable}
              style={{ cursor: "pointer", outline: "none" }}
              onMouseEnter={() => setSelected(c.id)}
              onFocus={() => setSelected(c.id)}
              onClick={() => setSelected(c.id)}
            >
              {/* keyed by the value, so the ring replays once whenever the class average moves */}
              <circle
                key={`pulse-${c.avg}`}
                className={s.pulse}
                cx={x}
                cy={y}
                r={R}
                fill="none"
                stroke={BAND_COLOR[b]}
                strokeWidth="3"
                opacity="0"
              />
              <circle
                cx={x}
                cy={y}
                r={R}
                fill={b === "none" ? "url(#gg-hatch)" : BAND_COLOR[b]}
                fillOpacity={b === "none" ? 1 : 0.16}
                stroke={BAND_COLOR[b]}
                strokeWidth={selected === c.id ? 3.5 : 2.5}
                style={{ transition: "fill 500ms, stroke 500ms" }}
              />
              <text
                x={x}
                y={y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontWeight="700"
                fontSize="17"
                fill="var(--ink)"
              >
                {c.avg === null ? "–" : Math.round(c.avg * 100)}
                {projector && b !== "none" ? ` ${BAND_ICON[b]}` : ""}
              </text>
              <text
                x={x}
                y={y + R + (isFocus ? 26 : 17)}
                textAnchor="middle"
                fontSize="12.5"
                fontWeight={isFocus ? 600 : 400}
                fill={isFocus ? "var(--ink)" : "var(--graphite)"}
                stroke="#fff"
                strokeWidth="4"
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {c.short}
              </text>
              {isFocus ? (
                <>
                  <path
                    key={`ring-${focus}`}
                    d={ring}
                    fill="none"
                    stroke="var(--red-pen)"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    className={s.draw}
                    style={{ ["--len" as string]: 320 }}
                  />
                  <text
                    x={x + R + 12}
                    y={y - R - 6}
                    className={s.hand}
                    fontSize="17"
                    fill="var(--red-pen)"
                    transform={`rotate(-8 ${x + R + 12} ${y - R - 6})`}
                  >
                    focus
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
      {shown ? (
        <div className="mt-2 rounded-xl border border-[var(--rule)] bg-white/80 p-3 text-[0.9em]" aria-live="polite">
          <div className="font-semibold">{shown.name}</div>
          <div className={s.muted}>
            {shown.avg === null
              ? "Nobody has answered this yet."
              : `Class average ${Math.round(shown.avg * 100)} (${BAND_WORDS[band(shown.avg)]}), ${shown.responders} students assessed, ${shown.open_gaps} open ${shown.open_gaps === 1 ? "gap" : "gaps"}.`}
          </div>
          {shown.top.length > 0 && (
            <div className="mt-1">
              Most common: <span className={s.hand}>{shown.top[0].label}</span>{" "}
              <span className={s.muted}>({shown.top[0].students} students)</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
