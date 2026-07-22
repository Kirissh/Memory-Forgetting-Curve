"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FramedAvatar } from "@/components/FramedAvatar";
import { getFrame } from "@/lib/frames";

type LeaderKind = "you" | "user" | "rival";
type LeaderRow = {
  id: string;
  name: string;
  kind: LeaderKind;
  studyMinutes: number;
  efficiency: number;
  correct: number;
  streak: number;
  color?: string;
  avatarImage?: string | null;
  equippedFrame?: string | null;
};

type Sort = "study" | "efficiency";

function fmtTime(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [sort, setSort] = useState<Sort>("study");

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((d) => d && setRows(d.rows || []))
      .catch(() => {});
  }, [router]);

  const ranked = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) =>
      sort === "study"
        ? b.studyMinutes - a.studyMinutes || b.efficiency - a.efficiency
        : b.efficiency - a.efficiency || b.studyMinutes - a.studyMinutes
    );
    return list;
  }, [rows, sort]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="eyebrow text-aurora">Leaderboard</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
        Who&apos;s <span className="text-aurora">grinding</span>
      </h1>
      <p className="mt-3 max-w-xl text-[var(--muted)]">
        Ranked by focused study time and efficiency. Rivals are your poker
        table; real accounts show their framed avatars.
      </p>

      <div className="mt-6 inline-flex gap-1 rounded-full border border-[var(--line)] p-1 text-xs">
        {(
          [
            ["study", "Study time"],
            ["efficiency", "Efficiency"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSort(key)}
            aria-pressed={sort === key}
            className={`rounded-full px-4 py-1.5 transition-colors ${
              sort === key
                ? "bg-[var(--accent)] font-medium text-[#0a1220]"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!rows ? (
        <p className="mt-10 text-[var(--muted)]">Loading leaderboard…</p>
      ) : (
        <div className="mt-6 space-y-2">
          {ranked.map((row, i) => {
            const isYou = row.kind === "you";
            const medal = ["🥇", "🥈", "🥉"][i] ?? null;
            return (
              <div
                key={row.id}
                className={`panel flex items-center gap-4 px-4 py-3 ${
                  isYou ? "ring-1 ring-[var(--accent)]" : ""
                }`}
              >
                <span className="w-7 shrink-0 text-center font-[family-name:var(--font-display)] text-lg tabular-nums">
                  {medal ?? i + 1}
                </span>
                <FramedAvatar
                  frame={getFrame(row.equippedFrame)}
                  initial={row.name.charAt(0) || "?"}
                  imageSrc={row.avatarImage}
                  baseColor={row.color}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-medium">
                    {row.name}
                    {isYou && (
                      <span className="chip px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--accent)]">
                        you
                      </span>
                    )}
                    {row.kind === "rival" && (
                      <span className="chip px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                        rival
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--muted)] tabular-nums">
                    🔥 {row.streak} · {row.correct} correct
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`font-[family-name:var(--font-display)] text-lg tabular-nums ${
                      sort === "study" ? "text-[var(--accent)]" : ""
                    }`}
                  >
                    {fmtTime(row.studyMinutes)}
                  </p>
                  <p
                    className={`text-xs tabular-nums ${
                      sort === "efficiency"
                        ? "text-[var(--accent)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {Math.round(row.efficiency * 100)}% eff
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
