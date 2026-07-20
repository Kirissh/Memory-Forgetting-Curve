"use client";

import { Nav } from "@/components/Nav";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ModelScore {
  name: string;
  logLoss: number;
  brier: number;
  ece: number;
  accuracy: number;
  n: number;
}
interface CalBin {
  lower: number;
  upper: number;
  predictedMean: number;
  empiricalRate: number;
  count: number;
}
interface Driver {
  name: string;
  weight: number;
  prior: number;
  meanContribution: number;
}
interface Leech {
  conceptId: string;
  title: string;
  severity: number;
  lapseRate: number;
  reasons: string[];
}
interface Insights {
  model: {
    trainedAt: string;
    trainedOnReviewCount: number;
    usingPrior: boolean;
    heldOutLogLoss: number | null;
    baselineLogLoss: number | null;
    comparison: ModelScore[];
    calibrationBins: CalBin[];
    fsrsParams: number[] | null;
  } | null;
  trend: { weekStart: string; accuracy: number; n: number }[];
  drivers: Driver[];
  leeches: Leech[];
  summary: {
    concepts: number;
    totalReviews: number;
    accuracy: number;
    medianHalfLife: number;
    medianStability: number | null;
  };
}

const FEATURE_LABELS: Record<string, string> = {
  correct_streak: "Correct streak",
  incorrect_count: "Misses",
  log_total_reviews: "Times reviewed",
  avg_days_between_reviews: "Review spacing",
  concept_embedding_similarity: "Similar topics known",
  log_read_time: "Study time",
  log_response_time: "Answer speed",
  trap_fail_rate: "Trap fails",
  difficulty: "Felt difficulty",
};

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** Reliability diagram: predicted vs observed, with the perfect-calibration diagonal. */
function ReliabilityDiagram({ bins }: { bins: CalBin[] }) {
  const S = 260;
  const P = 34;
  const plot = S - P * 2;
  const x = (v: number) => P + v * plot;
  const y = (v: number) => P + (1 - v) * plot;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[320px]" role="img"
      aria-label="Reliability diagram: predicted probability versus observed recall rate">
      {/* frame + gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={x(0)} x2={x(1)} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
          <text x={x(0) - 6} y={y(g) + 3} textAnchor="end" style={{ fontSize: 9 }} className="fill-[var(--muted)]">
            {Math.round(g * 100)}
          </text>
          <text x={x(g)} y={y(0) + 14} textAnchor="middle" style={{ fontSize: 9 }} className="fill-[var(--muted)]">
            {Math.round(g * 100)}
          </text>
        </g>
      ))}
      {/* perfect-calibration diagonal */}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" />
      {/* observed points */}
      {bins.map((b, i) => (
        <circle
          key={i}
          cx={x(b.predictedMean)}
          cy={y(b.empiricalRate)}
          r={3 + 6 * (b.count / maxCount)}
          fill="var(--accent)"
          fillOpacity={0.75}
          stroke="var(--bg-panel)"
          strokeWidth={1.5}
        />
      ))}
      <text x={x(0.5)} y={S - 4} textAnchor="middle" style={{ fontSize: 10 }} className="fill-[var(--muted)]">
        Predicted recall %
      </text>
    </svg>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setEmail(d.user.email));
  }, []);

  useEffect(() => {
    fetch("/api/insights")
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .finally(() => setLoading(false));
  }, [router]);

  const cmp = data?.model?.comparison ?? [];
  // Winner per column (lower better except accuracy).
  const best = {
    logLoss: Math.min(...cmp.map((m) => m.logLoss), Infinity),
    brier: Math.min(...cmp.map((m) => m.brier), Infinity),
    ece: Math.min(...cmp.map((m) => m.ece), Infinity),
    accuracy: Math.max(...cmp.map((m) => m.accuracy), -Infinity),
  };
  const win = (v: number, b: number) => Math.abs(v - b) < 1e-9;

  const maxDriver = Math.max(1e-6, ...(data?.drivers ?? []).map((d) => Math.abs(d.meanContribution)));

  return (
    <>
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent)]">Model insights</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          Is the model any good?
        </h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          The trained Half-Life Regression, scored head-to-head against the cold-start
          prior, classic <span className="text-[var(--ink)]/80">SM-2</span>, and a
          per-card <span className="text-[var(--ink)]/80">FSRS</span> model — on the same
          held-out reviews, with a calibration check so the probabilities are honest.
        </p>

        {loading ? (
          <p className="mt-10 text-[var(--muted)]">Loading insights…</p>
        ) : !data ? (
          <p className="mt-10 text-[var(--muted)]">No data yet.</p>
        ) : (
          <>
            {/* Summary KPIs */}
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Concepts", String(data.summary.concepts)],
                ["Reviews", String(data.summary.totalReviews)],
                ["Overall accuracy", pct(data.summary.accuracy)],
                ["Median half-life", `${data.summary.medianHalfLife.toFixed(1)}d`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-4">
                  <p className="text-xs text-[var(--muted)]">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">{value}</p>
                </div>
              ))}
            </div>

            {data.model?.usingPrior && (
              <p className="mt-4 rounded-xl border border-[var(--warn)]/30 bg-[var(--warn)]/5 px-4 py-3 text-sm text-[var(--muted)]">
                Still on cold-start prior weights — the comparison needs ≥10 reviews to
                personalize. Study a session to train.
              </p>
            )}

            {/* Model comparison */}
            <section className="mt-10">
              <h2 className="font-[family-name:var(--font-display)] text-2xl">Model face-off</h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
                Held-out mean over each model&apos;s predictions. Lower is better for
                log-loss / Brier / calibration error (ECE); higher for accuracy.
                Best in each column is highlighted.
              </p>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wider text-[var(--muted)]">
                      <th className="px-4 py-3 font-normal">Model</th>
                      <th className="px-4 py-3 text-right font-normal">Log-loss</th>
                      <th className="px-4 py-3 text-right font-normal">Brier</th>
                      <th className="px-4 py-3 text-right font-normal">ECE</th>
                      <th className="px-4 py-3 text-right font-normal">Accuracy</th>
                      <th className="px-4 py-3 text-right font-normal">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.map((m) => {
                      const isHlr = m.name.startsWith("HLR");
                      return (
                        <tr key={m.name} className="border-b border-[var(--line)] last:border-0">
                          <td className={`px-4 py-3 ${isHlr ? "font-semibold text-[var(--accent)]" : "text-[var(--ink)]"}`}>
                            {m.name}
                          </td>
                          {([
                            [m.logLoss, win(m.logLoss, best.logLoss)],
                            [m.brier, win(m.brier, best.brier)],
                            [m.ece, win(m.ece, best.ece)],
                          ] as const).map(([v, w], i) => (
                            <td key={i} className={`px-4 py-3 text-right tabular-nums ${w ? "font-semibold text-[var(--ok)]" : "text-[var(--muted)]"}`}>
                              {v.toFixed(4)}
                            </td>
                          ))}
                          <td className={`px-4 py-3 text-right tabular-nums ${win(m.accuracy, best.accuracy) ? "font-semibold text-[var(--ok)]" : "text-[var(--muted)]"}`}>
                            {pct(m.accuracy)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">{m.n}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                A perfect coin-flip scores log-loss 0.693. FSRS is fit per-card; SM-2 is a
                fixed formula; HLR and the prior share the same feature model, trained vs not.
              </p>
            </section>

            {/* Calibration + drivers side by side */}
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-5">
                <h2 className="font-[family-name:var(--font-display)] text-xl">Calibration</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Trained HLR, held out. Dots on the dashed line mean a predicted-70% card
                  really is recalled ~70%. Dot size = how many reviews landed there.
                </p>
                <div className="mt-4 flex justify-center">
                  {data.model && data.model.calibrationBins.length > 0 ? (
                    <ReliabilityDiagram bins={data.model.calibrationBins} />
                  ) : (
                    <p className="py-10 text-sm text-[var(--muted)]">Not enough held-out reviews yet.</p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-5">
                <h2 className="font-[family-name:var(--font-display)] text-xl">What drives your half-lives</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Mean contribution of each feature to log-half-life across your cards.
                  Green lengthens memory, red shortens it.
                </p>
                <ul className="mt-4 space-y-2.5">
                  {data.drivers.slice(0, 8).map((d) => {
                    const w = (Math.abs(d.meanContribution) / maxDriver) * 100;
                    const pos = d.meanContribution >= 0;
                    return (
                      <li key={d.name} className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-2">
                        <span className="truncate text-xs text-[var(--muted)]">
                          {FEATURE_LABELS[d.name] ?? d.name}
                        </span>
                        <span className="relative flex h-3 items-center">
                          <span className="absolute left-1/2 top-0 h-3 w-px bg-[var(--line)]" />
                          <span
                            className={`absolute h-2 rounded-full ${pos ? "bg-[var(--ok)]/70" : "bg-[var(--danger)]/70"}`}
                            style={pos ? { left: "50%", width: `${w / 2}%` } : { right: "50%", width: `${w / 2}%` }}
                          />
                        </span>
                        <span className="text-right text-xs tabular-nums text-[var(--muted)]">
                          {d.meanContribution >= 0 ? "+" : ""}
                          {d.meanContribution.toFixed(2)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            {/* Accuracy trend */}
            {data.trend.length > 1 && (
              <section className="mt-10">
                <h2 className="font-[family-name:var(--font-display)] text-2xl">Accuracy over time</h2>
                <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-5">
                  <div className="flex items-end gap-2" style={{ height: 140 }}>
                    {data.trend.map((t, i) => (
                      <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className="w-full rounded-t bg-[var(--accent)]/70"
                            style={{ height: `${Math.max(3, t.accuracy * 100)}%` }}
                            title={`${pct(t.accuracy)} over ${t.n} reviews`}
                          />
                        </div>
                        <span className="text-[10px] tabular-nums text-[var(--muted)]">{pct(t.accuracy)}</span>
                        <span className="text-[10px] text-[var(--muted)]">wk {i + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Leeches */}
            <section className="mt-10">
              <h2 className="font-[family-name:var(--font-display)] text-2xl">Leeches</h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
                Cards that keep getting failed and refuse to stick. Reformulate these rather
                than grinding them.
              </p>
              {data.leeches.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-6 text-sm text-[var(--muted)]">
                  No leeches — nothing is chronically failing. 🎉
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {data.leeches.map((l) => (
                    <li key={l.conceptId} className="flex items-center gap-4 rounded-xl border border-[var(--danger)]/25 bg-[var(--bg-panel)] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{l.reasons.join(" · ")}</p>
                      </div>
                      <span className="shrink-0 text-right">
                        <span className="text-lg font-semibold tabular-nums text-[var(--danger)]">
                          {Math.round(l.severity * 100)}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">severity</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
