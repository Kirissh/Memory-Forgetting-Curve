"use client";

import { useEffect, useState } from "react";

type GridDay = {
  date: string;
  count: number;
  pokerHands: number;
  correctCards: number;
  brains: number;
};

type BrainsSummary = {
  balance: number;
  streak: number;
  longestStreak: number;
  today: { pokerHands: number; correctCards: number; brains: number };
  grid: GridDay[];
};

/** GitHub-style intensity ramp keyed on total contributions that day. */
function levelClass(count: number): string {
  if (count <= 0) return "bg-[var(--line)]/40";
  if (count < 3) return "bg-[var(--accent)]/25";
  if (count < 6) return "bg-[var(--accent)]/50";
  if (count < 10) return "bg-[var(--accent)]/75";
  return "bg-[var(--accent)]";
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sun
}

function fmt(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Split the flat oldest→newest grid into GitHub-style week columns (Sun–Sat). */
function toWeeks(grid: GridDay[]): (GridDay | null)[][] {
  const weeks: (GridDay | null)[][] = [];
  let col: (GridDay | null)[] = [];
  if (grid.length) {
    for (let i = 0; i < weekday(grid[0].date); i++) col.push(null);
  }
  for (const day of grid) {
    col.push(day);
    if (weekday(day.date) === 6) {
      weeks.push(col);
      col = [];
    }
  }
  if (col.length) {
    while (col.length < 7) col.push(null);
    weeks.push(col);
  }
  return weeks;
}

export function StreakTracker() {
  const [data, setData] = useState<BrainsSummary | null>(null);

  useEffect(() => {
    fetch("/api/brains")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);

  if (!data) return null;

  const weeks = toWeeks(data.grid);
  const totalCards = data.grid.reduce((s, d) => s + d.correctCards, 0);
  const totalHands = data.grid.reduce((s, d) => s + d.pokerHands, 0);

  return (
    <section id="brains" className="panel scroll-mt-20 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Recall Brains
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Earn Brains by studying and betting well. Keep the fire alive daily.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span
            className={`flex items-center gap-1.5 ${
              data.streak ? "" : "opacity-40 grayscale"
            }`}
            title="Consecutive active days"
          >
            <span className="text-lg">🔥</span>
            <span className="tabular-nums">
              <span className="text-[var(--ink)]">{data.streak}</span>
              <span className="text-[var(--muted)]"> day streak</span>
            </span>
          </span>
          <span
            className="flex items-center gap-1.5"
            title="Your Recall Brains balance"
          >
            <span className="text-lg">🧠</span>
            <span className="tabular-nums text-[var(--accent)]">
              {data.balance}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div className="flex gap-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day, di) =>
                day ? (
                  <div
                    key={day.date}
                    title={
                      day.count > 0
                        ? `${fmt(day.date)} · ${day.correctCards} correct · ${day.pokerHands} hand${day.pokerHands === 1 ? "" : "s"} · ${day.brains >= 0 ? "+" : ""}${day.brains} 🧠`
                        : `${fmt(day.date)} · no activity`
                    }
                    className={`h-3 w-3 rounded-[3px] ${levelClass(day.count)}`}
                  />
                ) : (
                  <div key={`e${wi}-${di}`} className="h-3 w-3 rounded-[3px]" />
                )
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span>
          {totalCards} correct · {totalHands} hands · longest streak{" "}
          {data.longestStreak}d
        </span>
        <span className="flex items-center gap-1.5">
          Less
          <span className="h-3 w-3 rounded-[3px] bg-[var(--line)]/40" />
          <span className="h-3 w-3 rounded-[3px] bg-[var(--accent)]/25" />
          <span className="h-3 w-3 rounded-[3px] bg-[var(--accent)]/50" />
          <span className="h-3 w-3 rounded-[3px] bg-[var(--accent)]/75" />
          <span className="h-3 w-3 rounded-[3px] bg-[var(--accent)]" />
          More
        </span>
      </div>
    </section>
  );
}
