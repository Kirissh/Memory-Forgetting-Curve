"use client";

import { useMemo, useRef, useState } from "react";
import { predictRecall } from "@/lib/retention";
import type { CurvePoint, ForgetBand } from "@/lib/hlr";

const W = 780;
const H = 400;
const M = { top: 18, right: 104, bottom: 44, left: 46 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** --bg-panel: the chart's surface, used for mark rings so dots stay legible on crossings. */
const SURFACE = "#121b2b";

export const BAND_META: Record<
  ForgetBand,
  { color: string; label: string; icon: string }
> = {
  faded: { color: "var(--danger)", label: "Already faded", icon: "▼" },
  fading: { color: "var(--warn)", label: "Fading soon", icon: "◆" },
  safe: { color: "var(--accent)", label: "Holding", icon: "●" },
};

const BAND_ORDER: ForgetBand[] = ["faded", "fading", "safe"];

/** Composite encoding: band carries a shape as well as a hue, so CVD never gates it. */
function BandMark({
  band,
  cx,
  cy,
  ring = true,
}: {
  band: ForgetBand;
  cx: number;
  cy: number;
  ring?: boolean;
}) {
  const fill = BAND_META[band].color;
  const stroke = ring ? { stroke: SURFACE, strokeWidth: 2 } : {};
  if (band === "safe") {
    return <circle cx={cx} cy={cy} r={4.5} fill={fill} {...stroke} />;
  }
  if (band === "fading") {
    return (
      <path
        d={`M${cx} ${cy - 5.5}L${cx + 5.5} ${cy}L${cx} ${cy + 5.5}L${cx - 5.5} ${cy}Z`}
        fill={fill}
        {...stroke}
      />
    );
  }
  return (
    <path
      d={`M${cx - 5.5} ${cy - 4.5}L${cx + 5.5} ${cy - 4.5}L${cx} ${cy + 5.5}Z`}
      fill={fill}
      {...stroke}
    />
  );
}

function fmtDay(nowMs: number, dayOffset: number): string {
  return new Date(nowMs + dayOffset * 86400000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function fmtUntil(days: number): string {
  if (days <= 0) return "overdue";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 60) return `${Math.round(days)}d`;
  return `${(days / 30).toFixed(1)}mo`;
}

export function ForgettingCurveChart({
  concepts,
  threshold,
  nowMs,
}: {
  concepts: CurvePoint[];
  threshold: number;
  nowMs: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const { xMin, xMax } = useMemo(() => {
    if (concepts.length === 0) return { xMin: -1, xMax: 14 };
    const maxPast = Math.max(...concepts.map((c) => c.daysSinceAnchor), 1);
    const maxFuture = Math.max(...concepts.map((c) => c.daysUntilForget), 7);
    return {
      xMin: -Math.min(Math.ceil(maxPast), 30),
      xMax: Math.min(Math.max(Math.ceil(maxFuture * 1.15), 14), 60),
    };
  }, [concepts]);

  const x = (d: number) => M.left + ((d - xMin) / (xMax - xMin)) * PLOT_W;
  const y = (p: number) => M.top + (1 - p) * PLOT_H;

  const recallAt = (c: CurvePoint, dayOffset: number) =>
    predictRecall(c.halfLifeDays, Math.max(c.daysSinceAnchor + dayOffset, 0));

  const curvePath = (c: CurvePoint, from: number, to: number) => {
    if (to <= from) return "";
    const n = 56;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      pts.push(`${x(t).toFixed(2)},${y(recallAt(c, t)).toFixed(2)}`);
    }
    return "M" + pts.join("L");
  };

  // Label only the few that matter; the table carries every value. Crossings can sit
  // hours apart, so nudge colliding labels along and let a leader line hold the link.
  const labelled = useMemo(() => {
    const picked = concepts
      .filter((c) => c.daysUntilForget > xMin && c.daysUntilForget < xMax)
      .slice(0, 3)
      .map((c) => ({
        c,
        cx: x(c.daysUntilForget),
        w: c.title.length * 6.3 + 22,
        lx: 0,
      }))
      .sort((a, b) => a.cx - b.cx);

    let cursor = -Infinity;
    for (const l of picked) {
      const lo = M.left + l.w / 2;
      const hi = M.left + PLOT_W - l.w / 2;
      l.lx = Math.min(Math.max(Math.max(l.cx, cursor + l.w / 2), lo), hi);
      cursor = l.lx + l.w / 2;
    }
    return picked;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concepts, xMin, xMax]);

  const xTicks = useMemo(() => {
    const span = xMax - xMin;
    const step = span <= 16 ? 2 : span <= 32 ? 5 : 10;
    const ticks: number[] = [];
    for (let d = Math.ceil(xMin / step) * step; d <= xMax; d += step) ticks.push(d);
    return ticks;
  }, [xMin, xMax]);

  const hovered = useMemo(() => {
    if (hoverDay == null) return null;
    return concepts
      .map((c) => ({ c, p: recallAt(c, hoverDay) }))
      .sort((a, b) => a.p - b.p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverDay, concepts]);

  function onMove(e: React.PointerEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    if (svgX < M.left || svgX > M.left + PLOT_W) return setHoverDay(null);
    const day = xMin + ((svgX - M.left) / PLOT_W) * (xMax - xMin);
    setHoverDay(Math.round(day * 2) / 2);
  }

  if (concepts.length === 0) {
    return (
      <p className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-8 text-center text-[var(--muted)]">
        Nothing learned yet — upload a note and study a deck to see your curve.
      </p>
    );
  }

  const tipLeft = hoverDay != null ? (x(hoverDay) / W) * 100 : 0;
  const tipFlip = tipLeft > 58;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onPointerMove={onMove}
      onPointerLeave={() => setHoverDay(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Forgetting curves for ${concepts.length} concepts, with the ${Math.round(threshold * 100)} percent recall threshold. Full values in the table below.`}
      >
        {/* Grid — solid hairlines, one step off surface, recessive */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line
              x1={M.left}
              x2={M.left + PLOT_W}
              y1={y(p)}
              y2={y(p)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={M.left - 10}
              y={y(p) + 4}
              textAnchor="end"
              className="fill-[var(--muted)]"
              style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}

        {xTicks.map((d) => (
          <text
            key={d}
            x={x(d)}
            y={M.top + PLOT_H + 20}
            textAnchor="middle"
            className="fill-[var(--muted)]"
            style={{ fontSize: 11 }}
          >
            {fmtDay(nowMs, d)}
          </text>
        ))}

        {/* Threshold rule — a real threshold, so it reads dashed (the grid stays solid) */}
        <line
          x1={M.left}
          x2={M.left + PLOT_W}
          y1={y(threshold)}
          y2={y(threshold)}
          stroke="var(--muted)"
          strokeWidth={1}
          strokeDasharray="5 4"
        />
        <text
          x={M.left + PLOT_W + 8}
          y={y(threshold) + 4}
          className="fill-[var(--muted)]"
          style={{ fontSize: 11 }}
        >
          {Math.round(threshold * 100)}% — forgotten
        </text>

        {/* Now */}
        <line
          x1={x(0)}
          x2={x(0)}
          y1={M.top}
          y2={M.top + PLOT_H}
          stroke="var(--muted)"
          strokeWidth={1}
        />
        <text
          x={x(0)}
          y={M.top - 5}
          textAnchor="middle"
          className="fill-[var(--muted)]"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          NOW
        </text>

        {/* Curves: solid = elapsed, dashed = projection */}
        {concepts.map((c) => {
          const start = Math.max(xMin, -c.daysSinceAnchor);
          const color = BAND_META[c.band].color;
          const dim = hoverDay != null ? 0.5 : 0.85;
          return (
            <g key={c.conceptId}>
              <path
                d={curvePath(c, start, 0)}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={dim}
              />
              <path
                d={curvePath(c, 0, xMax)}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray="4 5"
                opacity={dim * 0.8}
              />
            </g>
          );
        })}

        {/* Where you are now */}
        {concepts.map((c) => (
          <BandMark
            key={c.conceptId}
            band={c.band}
            cx={x(0)}
            cy={y(c.recallNow)}
          />
        ))}

        {/* Direct labels at the threshold crossing — leader lines keep them attached */}
        {labelled.map(({ c, cx, lx }) => {
          const cy = y(threshold);
          const ly = cy - 26;
          return (
            <g key={c.conceptId}>
              <line
                x1={cx}
                y1={cy}
                x2={lx}
                y2={ly + 5}
                stroke="var(--muted)"
                strokeWidth={1}
                opacity={0.5}
              />
              <circle
                cx={cx}
                cy={cy}
                r={2.5}
                fill="var(--muted)"
                stroke={SURFACE}
                strokeWidth={1.5}
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                className="fill-[var(--ink)]"
                style={{ fontSize: 11, paintOrder: "stroke" }}
                stroke={SURFACE}
                strokeWidth={3}
                strokeLinejoin="round"
              >
                {c.title}
              </text>
            </g>
          );
        })}

        {/* Crosshair */}
        {hoverDay != null && (
          <line
            x1={x(hoverDay)}
            x2={x(hoverDay)}
            y1={M.top}
            y2={M.top + PLOT_H}
            stroke="var(--ink)"
            strokeWidth={1}
            opacity={0.35}
          />
        )}
        {hoverDay != null &&
          concepts.map((c) => (
            <circle
              key={c.conceptId}
              cx={x(hoverDay)}
              cy={y(recallAt(c, hoverDay))}
              r={3}
              fill={BAND_META[c.band].color}
              stroke={SURFACE}
              strokeWidth={1.5}
            />
          ))}
      </svg>

      {/* One tooltip, every series — the pointer never has to find a line */}
      {hoverDay != null && hovered && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-56 rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)]/95 p-3 shadow-xl backdrop-blur-sm"
          style={
            tipFlip
              ? { right: `${100 - tipLeft}%`, marginRight: 12 }
              : { left: `${tipLeft}%`, marginLeft: 12 }
          }
        >
          <p className="text-xs text-[var(--muted)]">
            {fmtDay(nowMs, hoverDay)}
            {hoverDay === 0 ? " · now" : hoverDay > 0 ? ` · in ${fmtUntil(hoverDay)}` : ""}
          </p>
          <ul className="mt-2 space-y-1.5">
            {hovered.slice(0, 6).map(({ c, p }) => (
              <li key={c.conceptId} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ background: BAND_META[c.band].color }}
                />
                <span
                  className="text-sm font-medium text-[var(--ink)]"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {Math.round(p * 100)}%
                </span>
                <span className="truncate text-xs text-[var(--muted)]">
                  {c.title}
                </span>
              </li>
            ))}
          </ul>
          {hovered.length > 6 && (
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">
              +{hovered.length - 6} more in the table
            </p>
          )}
        </div>
      )}

      {/* Legend — status always ships icon + label */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
        {BAND_ORDER.map((b) => (
          <li key={b} className="flex items-center gap-1.5">
            <span aria-hidden style={{ color: BAND_META[b].color }}>
              {BAND_META[b].icon}
            </span>
            {BAND_META[b].label}
          </li>
        ))}
        <li className="ml-auto flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="22"
              y2="3"
              stroke="var(--muted)"
              strokeWidth="2"
              strokeDasharray="4 5"
            />
          </svg>
          Projected
        </li>
      </ul>
    </div>
  );
}
