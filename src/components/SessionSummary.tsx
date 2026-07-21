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
  totalReviews?: number;
};

export function SessionSummary({
  reviewed,
  correct,
  weakTopics,
  pokerDelta,
  pokerCredits,
  pokerStandings,
  onQueue,
}: {
  reviewed: number;
  correct: number;
  weakTopics?: WeakTopic[];
  pokerDelta?: number;
  pokerCredits?: number;
  pokerStandings?: { name: string; stack: number }[];
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
      <p className="eyebrow text-aurora text-center">
        Step 5 · What you might forget
      </p>
      <h1 className="mt-4 text-center font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
        Session <span className="text-aurora">readout</span>
      </h1>
      <p className="mt-3 text-center text-[var(--muted)]">
        {reviewed} checks · {correct} correct ({pct}%) · model weights refit
      </p>
      {typeof pokerCredits === "number" && (
        <p className="mt-2 text-center text-sm text-[var(--accent)]">
          {pokerCredits <= 0 ? (
            <span className="text-[var(--danger)]">Busted — table closed</span>
          ) : (
            <>
              Poker stack {pokerCredits}
              {typeof pokerDelta === "number" && pokerDelta !== 0 && (
                <span
                  className={
                    pokerDelta > 0
                      ? " text-[var(--ok)]"
                      : " text-[var(--danger)]"
                  }
                >
                  {" "}
                  ({pokerDelta > 0 ? "+" : ""}
                  {pokerDelta} this session)
                </span>
              )}
            </>
          )}
        </p>
      )}
      {pokerStandings && pokerStandings.length > 0 && (
        <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
          {pokerStandings.map((row, i) => (
            <span
              key={row.name}
              className="chip px-2.5 py-1 text-xs tabular-nums"
            >
              #{i + 1} {row.name} · {row.stack}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-xs text-[var(--muted)]">
        More attempts per topic make the forget map sharper — keep stacking
        reviews.
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
                className="panel relative overflow-hidden rounded-2xl px-4 py-4"
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
                        <span className="chip bg-[var(--danger-dim)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--danger)]">
                          missed
                        </span>
                      )}
                      {w.trapFailed && (
                        <span className="chip bg-[var(--danger-dim)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--danger)]">
                          trap
                        </span>
                      )}
                      <span className="chip px-2 py-0.5 text-[10px] text-[var(--muted)]">
                        hard {w.difficulty}/5
                      </span>
                      {typeof w.totalReviews === "number" && (
                        <span className="chip px-2 py-0.5 text-[10px] tabular-nums text-[var(--muted)]">
                          {w.totalReviews} attempts
                        </span>
                      )}
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
          className="btn-primary px-6 py-2.5 text-sm font-semibold"
        >
          Back to Queue
        </button>
        <Link href="/library" className="btn-ghost px-6 py-2.5 text-sm">
          Library
        </Link>
      </div>
    </div>
  );
}
