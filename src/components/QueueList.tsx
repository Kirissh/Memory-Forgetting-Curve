"use client";

import { useEffect, useState } from "react";

export type QueueItem = {
  conceptId: string;
  cardId: string;
  title: string;
  definition?: string;
  front: string;
  back: string;
  clozeText?: string | null;
  clozeAnswer?: string | null;
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
  isLeech?: boolean;
  leechReasons?: string[];
  materialId?: string;
};

function fadeTone(risk: number) {
  if (risk >= 0.55) return "text-[var(--danger)]";
  if (risk >= 0.35) return "text-[var(--warn)]";
  return "text-[var(--ok)]";
}

/** Bar shares the number's severity, so the row reads as one signal not two. */
function fadeBar(risk: number) {
  if (risk >= 0.55) return "bg-[var(--danger)]/70";
  if (risk >= 0.35) return "bg-[var(--warn)]/70";
  return "bg-[var(--ok)]/70";
}

/** "in ~7 days" beats "6.96d model horizon" for the person reading it. */
function horizonPhrase(days?: number): string {
  if (days == null) return "at your usual gap";
  if (days < 1.5) return "by tomorrow";
  return `in ~${Math.round(days)} days`;
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
      <div className="panel p-10 text-center">
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
  const horizon = horizonPhrase(horizonDays);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--muted)]">
            <span className="text-[var(--ink)]">{items.length} topics</span>,
            ranked by how likely you are to have forgotten them {horizon}.
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="btn-primary px-6 py-2.5 text-sm font-semibold"
        >
          Start learn → test
        </button>
      </div>

      {weak.length > 0 && (
        <section>
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Start here
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            The {weak.length} you&apos;re most likely to have lost {horizon}. Right
            after studying you&apos;d score ~100% on everything, so these are
            ranked by where you&apos;ll <em>be</em>, not where you are.
          </p>
          <div className="mt-4 space-y-2">
            {weak.map((item, i) => {
              const risk = item.fadeRisk ?? 1 - item.recallProbability;
              return (
                <div
                  key={`weak-${item.conceptId}`}
                  className="panel flex items-center gap-4 px-4 py-3 transition hover:border-[rgba(125,255,179,0.35)]"
                >
                  <span className="w-5 shrink-0 text-center text-sm tabular-nums text-[var(--muted)]">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      {item.why}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-xl font-semibold tabular-nums ${fadeTone(risk)}`}
                    >
                      {Math.round(risk * 100)}%
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      chance forgotten
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-[family-name:var(--font-display)] text-xl">
          Everything else
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          All {items.length} topics, weakest first. The bar is the same
          percentage on a 0–100 scale.
        </p>
        <ul className="mt-4 space-y-2">
          {items.map((item, i) => {
            const risk = item.fadeRisk ?? 1 - item.recallProbability;
            return (
              <li
                key={item.conceptId}
                className="panel px-4 py-3 transition hover:border-[rgba(125,255,179,0.35)] animate-rise"
                style={{ animationDelay: `${i * 35}ms` }}
              >
                <div className="flex items-center gap-4">
                  <span className="w-6 shrink-0 text-center text-sm tabular-nums text-[var(--muted)]">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-medium">{item.title}</h3>
                      {item.status === "new" && (
                        <span className="chip px-2 py-0.5 text-[10px] uppercase tracking-wider">
                          new
                        </span>
                      )}
                      {item.isLeech && (
                        <span
                          title={item.leechReasons?.join(" · ")}
                          className="chip bg-[var(--danger-dim)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--danger)]"
                        >
                          leech
                        </span>
                      )}
                      {item.avgDifficulty != null && (
                        <span className="chip px-2 py-0.5 text-[11px]">
                          rated {item.avgDifficulty.toFixed(0)}/5 to learn
                        </span>
                      )}
                    </div>
                    {/* Absolute 0–100, not scaled to the worst item: when every card
                        sits at 74–89% a relative bar renders them all full-width and
                        invents differences that aren't in the data. */}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${fadeBar(risk)}`}
                        style={{ width: `${Math.max(2, risk * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 max-w-xl text-xs text-[var(--muted)]">
                      {item.why}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-xl font-semibold tabular-nums ${fadeTone(risk)}`}
                    >
                      {Math.round(risk * 100)}%
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      chance forgotten
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
