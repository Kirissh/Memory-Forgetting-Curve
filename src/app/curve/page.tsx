"use client";

import { Nav } from "@/components/Nav";
import {
  ForgettingCurveChart,
  BAND_META,
  fmtUntil,
} from "@/components/ForgettingCurveChart";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CurvePoint } from "@/lib/hlr";

interface CurveResponse {
  concepts: CurvePoint[];
  threshold: number;
  fadingWithinDays: number;
  nowMs: number;
  summary: {
    faded: number;
    fading: number;
    safe: number;
    medianHalfLife: number;
  };
  model: {
    usingPrior: boolean;
    trainedOnReviewCount: number;
  };
}

const THRESHOLDS = [
  { value: 0.7, label: "70%" },
  { value: 0.5, label: "50%" },
  { value: 0.3, label: "30%" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CurvePage() {
  const [data, setData] = useState<CurveResponse | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(
    async (t: number, first: boolean) => {
      if (first) setLoading(true);
      else setRefreshing(true);
      const res = await fetch(`/api/curve?threshold=${t}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) setData(await res.json());
      setLoading(false);
      setRefreshing(false);
    },
    [router]
  );

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setEmail(d.user.email));
  }, []);

  useEffect(() => {
    load(threshold, data == null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  const pct = Math.round(threshold * 100);

  return (
    <>
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
          Retention forecast
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          When you&apos;ll forget it
        </h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Every concept you&apos;ve learned, placed on its own forgetting curve.
          Solid is time already elapsed; dashed is where{" "}
          <span className="text-[var(--ink)]/80">
            P = 2<sup>−Δt/h</sup>
          </span>{" "}
          says you&apos;re headed. Where a curve crosses {pct}% is the day that
          concept slips.
        </p>
        {data && (
          <p className="mt-4 text-xs text-[var(--muted)]">
            {data.model.usingPrior
              ? "Cold-start prior weights (need ≥10 tests to personalize)."
              : `Half-lives personalized on ${data.model.trainedOnReviewCount} tests.`}{" "}
            Median half-life {data.summary.medianHalfLife.toFixed(1)}d.
          </p>
        )}

        {/* Filter row — one row, above everything it scopes */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--muted)]">Count as forgotten below</span>
          <div className="flex gap-1 rounded-full border border-[var(--line)] p-1">
            {THRESHOLDS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setThreshold(t.value)}
                aria-pressed={threshold === t.value}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  threshold === t.value
                    ? "bg-[var(--accent)] font-medium text-[#06110a]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="mt-8 text-[var(--muted)]">Loading curve…</p>
        ) : !data ? null : (
          // Refetch keeps the frame — hold the render, no skeleton flash
          <div className={refreshing ? "opacity-60 transition-opacity" : ""}>
            {/* KPI row */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              {(
                [
                  ["faded", data.summary.faded],
                  ["fading", data.summary.fading],
                  ["safe", data.summary.safe],
                ] as const
              ).map(([band, count]) => (
                <div
                  key={band}
                  className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-4"
                >
                  <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <span aria-hidden style={{ color: BAND_META[band].color }}>
                      {BAND_META[band].icon}
                    </span>
                    {BAND_META[band].label}
                  </p>
                  <p className="mt-1 text-3xl font-semibold text-[var(--ink)]">
                    {count}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-4 sm:p-5">
              <ForgettingCurveChart
                concepts={data.concepts}
                threshold={data.threshold}
                nowMs={data.nowMs}
              />
            </div>

            {/* Table twin — every value reachable without hovering */}
            <h2 className="mt-10 font-[family-name:var(--font-display)] text-2xl">
              Forecast
            </h2>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="px-4 py-3 font-normal">Concept</th>
                    <th className="px-4 py-3 font-normal">State</th>
                    <th className="px-4 py-3 text-right font-normal">Recall now</th>
                    <th className="px-4 py-3 text-right font-normal">Half-life</th>
                    <th className="px-4 py-3 font-normal">Drops below {pct}%</th>
                    <th className="px-4 py-3 text-right font-normal">In</th>
                  </tr>
                </thead>
                <tbody>
                  {data.concepts.map((c) => (
                    <tr
                      key={c.conceptId}
                      className="border-b border-[var(--line)] last:border-0"
                    >
                      <td className="px-4 py-3">
                        <span className="text-[var(--ink)]">{c.title}</span>
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">
                          {c.why}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted)]">
                          <span
                            aria-hidden
                            style={{ color: BAND_META[c.band].color }}
                          >
                            {BAND_META[c.band].icon}
                          </span>
                          {BAND_META[c.band].label}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-right text-[var(--ink)]"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {Math.round(c.recallNow * 100)}%
                      </td>
                      <td
                        className="px-4 py-3 text-right text-[var(--muted)]"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {c.halfLifeDays.toFixed(1)}d
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">
                        {fmtDate(c.forgetAt)}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-3 text-right"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        <span
                          className={
                            c.daysUntilForget <= 0
                              ? "text-[var(--danger)]"
                              : "text-[var(--ink)]"
                          }
                        >
                          {fmtUntil(c.daysUntilForget)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
