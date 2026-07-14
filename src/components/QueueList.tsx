"use client";

import { useEffect, useState } from "react";

export type QueueItem = {
  conceptId: string;
  cardId: string;
  title: string;
  definition?: string;
  front: string;
  back: string;
  /** Ranking score: aged recall or projected recall — not raw P(Δt≈0) */
  recallProbability: number;
  recallNow?: number;
  projectedRecall?: number;
  /** 1 − projected recall at your model horizon — what "Likely fading" shows */
  fadeRisk?: number;
  halfLifeDays: number;
  daysSinceAnchor?: number;
  horizonDays?: number;
  lastReviewedAt: string | null;
  lastLearnedAt?: string | null;
  avgDifficulty?: number | null;
  avgReadTimeMs?: number | null;
  trapFailRate?: number;
  incorrectCount?: number;
  why: string;
  atRisk?: boolean;
  forgettingRisk?: number;
  status?: "new" | "learned" | "tested";
};

function fadeTone(risk: number) {
  if (risk >= 0.55) return "text-[var(--danger)]";
  if (risk >= 0.35) return "text-[var(--warn)]";
  return "text-[var(--ok)]";
}

export function QueueList({
  items,
  weakTopics,
  horizonDays,
  onStart,
}: {
  items: QueueItem[];
  weakTopics?: QueueItem[];
  horizonDays?: number;
  onStart: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-10 text-center">
        <p className="font-[family-name:var(--font-display)] text-2xl">
          Queue is empty
        </p>
        <p className="mt-2 text-[var(--muted)]">
          Upload material in your library to generate flashcards (step 1).
        </p>
      </div>
    );
  }

  const weak = weakTopics?.length
    ? weakTopics
    : items.slice(0, Math.max(3, Math.ceil(items.length / 3)));
  const maxFade = Math.max(...items.map((i) => i.fadeRisk ?? 0), 0.01);
  const horizonLabel =
    horizonDays != null ? `${horizonDays.toFixed(2)}d model horizon` : null;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--muted)]">
            {items.length} topics · ranked by HLR fade risk
            {horizonLabel ? ` · ${horizonLabel}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-[#06110a] transition hover:brightness-110"
        >
          Start learn → test
        </button>
      </div>

      {weak.length > 0 && (
        <section>
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Likely fading
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Fade risk = 1 − P(recall) at your model horizon — not right-now
            recall (which is ~100% right after studying)
          </p>
          <div className="mt-4 space-y-2">
            {weak.map((item, i) => {
              const risk = item.fadeRisk ?? 1 - item.recallProbability;
              const width = Math.max(12, (risk / maxFade) * 100);
              return (
                <div
                  key={`weak-${item.conceptId}`}
                  className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-panel)]"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-[var(--danger)]/15"
                    style={{ width: `${width}%` }}
                  />
                  <div className="relative flex items-center gap-3 px-4 py-3">
                    <span className="font-[family-name:var(--font-display)] text-lg text-[var(--danger)] tabular-nums w-6">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.title}</p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        {item.why}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`tabular-nums text-sm font-semibold ${fadeTone(risk)}`}
                      >
                        {Math.round(risk * 100)}%
                        <span className="ml-1 text-[10px] font-normal opacity-70">
                          fade
                        </span>
                      </p>
                      <p className="text-[10px] text-[var(--muted)] tabular-nums">
                        recall {Math.round((item.projectedRecall ?? item.recallProbability) * 100)}% · h=
                        {item.halfLifeDays.toFixed(1)}d
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-[family-name:var(--font-display)] text-xl">
          Full ranking
        </h2>
        <ul className="mt-4 space-y-2">
          {items.map((item, i) => {
            const risk = item.fadeRisk ?? 1 - item.recallProbability;
            const bar = Math.max(4, (risk / maxFade) * 100);
            return (
              <li
                key={item.conceptId}
                className="group rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/80 px-4 py-3 transition hover:border-[var(--accent)]/25 animate-rise"
                style={{ animationDelay: `${i * 35}ms` }}
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 text-center font-[family-name:var(--font-display)] text-lg text-[var(--muted)] tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-medium">{item.title}</h3>
                      {item.status === "new" && (
                        <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                          new
                        </span>
                      )}
                      {item.avgDifficulty != null && (
                        <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                          EOL {item.avgDifficulty.toFixed(1)}/5
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                      <div
                        className="h-full rounded-full bg-[var(--danger)]/70 transition-all duration-500"
                        style={{ width: `${bar}%` }}
                      />
                    </div>
                    <p className="mt-1.5 max-w-xl text-xs text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
                      {item.why}
                      {item.daysSinceAnchor != null && (
                        <> · Δt {item.daysSinceAnchor.toFixed(2)}d</>
                      )}
                      {item.recallNow != null && (
                        <> · now {Math.round(item.recallNow * 100)}%</>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`text-lg font-[family-name:var(--font-display)] tabular-nums ${fadeTone(risk)}`}
                    >
                      {Math.round(risk * 100)}
                      <span className="text-xs">%</span>
                    </p>
                    <p className="text-[10px] text-[var(--muted)]">
                      fade · h={item.halfLifeDays.toFixed(1)}d
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export function useQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [weakTopics, setWeakTopics] = useState<QueueItem[]>([]);
  const [horizonDays, setHorizonDays] = useState<number | undefined>();
  const [model, setModel] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/queue/today")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        setWeakTopics(data.weakTopics || []);
        setHorizonDays(data.horizonDays);
        setModel(data.model || null);
      })
      .finally(() => setLoading(false));
  }, []);

  return { items, weakTopics, horizonDays, model, loading, setItems };
}
