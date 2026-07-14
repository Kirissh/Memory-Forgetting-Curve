"use client";

import Link from "next/link";

export type WeakTopic = {
  title: string;
  difficulty: number;
  correct: boolean;
  trapFailed: boolean;
  halfLifeDays: number;
  recallProbability: number;
  why: string;
};

export function SessionSummary({
  reviewed,
  correct,
  weakTopics,
  onQueue,
}: {
  reviewed: number;
  correct: number;
  weakTopics?: WeakTopic[];
  onQueue: () => void;
}) {
  const pct = reviewed ? Math.round((correct / reviewed) * 100) : 0;
  const weak = weakTopics || [];
  const maxRisk = Math.max(
    ...weak.map((w) => 1 - w.recallProbability),
    0.01
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-12 animate-rise">
      <p className="text-center text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
        Step 5 · What you might forget
      </p>
      <h1 className="mt-4 text-center font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
        Session readout
      </h1>
      <p className="mt-3 text-center text-[var(--muted)]">
        {reviewed} checks · {correct} correct ({pct}%) · model weights refit
      </p>

      {weak.length > 0 ? (
        <div className="mt-10 space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Weakest topics by miss / trap / high EOL difficulty, ranked by model
            recall
          </p>
          {weak.map((w, i) => {
            const risk = 1 - w.recallProbability;
            const width = Math.max(8, (risk / maxRisk) * 100);
            return (
              <div
                key={`${w.title}-${i}`}
                className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-4"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--danger)]/10"
                  style={{ width: `${width}%` }}
                />
                <div className="relative flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] font-[family-name:var(--font-display)] text-sm text-[var(--danger)]">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-medium">{w.title}</h3>
                      {!w.correct && (
                        <span className="rounded-full bg-[var(--danger-dim)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--danger)]">
                          missed
                        </span>
                      )}
                      {w.trapFailed && (
                        <span className="rounded-full bg-[var(--danger-dim)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--danger)]">
                          trap
                        </span>
                      )}
                      <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                        hard {w.difficulty}/5
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{w.why}</p>
                    <p className="mt-2 text-xs tabular-nums text-[var(--ink)]/80">
                      {Math.round(risk * 100)}% fade risk · h=
                      {w.halfLifeDays.toFixed(1)}d · projected recall{" "}
                      {Math.round(w.recallProbability * 100)}%
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-10 text-center text-[var(--muted)]">
          No weak topics flagged — everything looked solid this round.
        </p>
      )}

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onQueue}
          className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-[#06110a]"
        >
          Back to Queue
        </button>
        <Link
          href="/library"
          className="rounded-full border border-[var(--line)] px-6 py-2.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Library
        </Link>
      </div>
    </div>
  );
}
