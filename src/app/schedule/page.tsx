"use client";

import { Nav } from "@/components/Nav";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface ScheduleItem {
  conceptId: string;
  title: string;
  halfLifeDays: number;
  idealReviewAtMs: number;
  scheduledReviewAtMs: number;
  targetRetention: number;
  recallAtScheduled: number;
  daysFromNow: number;
  shifted: boolean;
}
interface ScheduleResponse {
  items: ScheduleItem[];
  perDay: { dateMs: number; count: number }[];
  targetRetention: number;
  dailyCap: number;
  nowMs: number;
  ics: string;
  dueToday: number;
  dueThisWeek: number;
  shiftedCount: number;
  model: { usingPrior: boolean; trainedOnReviewCount: number };
}

const TARGETS = [
  { value: 0.8, label: "80%" },
  { value: 0.85, label: "85%" },
  { value: 0.9, label: "90%" },
  { value: 0.95, label: "95%" },
];
const CAPS = [4, 8, 12, 20];

function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function fmtUntil(days: number) {
  if (days < 1) return "today";
  if (days < 2) return "tomorrow";
  if (days < 60) return `${Math.round(days)}d`;
  return `${(days / 30).toFixed(1)}mo`;
}

export default function SchedulePage() {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [target, setTarget] = useState(0.9);
  const [cap, setCap] = useState(8);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setEmail(d.user.email));
  }, []);

  const load = useCallback(
    async (t: number, c: number) => {
      const res = await fetch(`/api/schedule?target=${t}&cap=${c}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) setData(await res.json());
      setLoading(false);
    },
    [router]
  );

  useEffect(() => {
    load(target, cap);
  }, [target, cap, load]);

  const downloadIcs = () => {
    if (!data) return;
    const blob = new Blob([data.ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recall-reviews.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const maxDay = Math.max(1, ...(data?.perDay ?? []).map((d) => d.count));
  const items = [...(data?.items ?? [])].sort(
    (a, b) => a.scheduledReviewAtMs - b.scheduledReviewAtMs
  );

  return (
    <>
      <Nav email={email} />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent)]">Review schedule</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          When to review each card
        </h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Each card is scheduled for the day its recall is forecast to fall to your
          target — <span className="text-[var(--ink)]/80">t = h · −log₂(target)</span> — then
          spread so no single day blows past your cap. Subscribe with the .ics feed.
        </p>

        {/* Controls */}
        <div className="mt-8 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)]">Target retention</span>
            <div className="flex gap-1 rounded-full border border-[var(--line)] p-1">
              {TARGETS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTarget(t.value)}
                  aria-pressed={target === t.value}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    target === t.value
                      ? "bg-[var(--accent)] font-medium text-[#06110a]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)]">Max / day</span>
            <div className="flex gap-1 rounded-full border border-[var(--line)] p-1">
              {CAPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCap(c)}
                  aria-pressed={cap === c}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    cap === c
                      ? "bg-[var(--accent)] font-medium text-[#06110a]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={downloadIcs}
            disabled={!data}
            className="ml-auto rounded-full border border-[var(--accent)]/40 bg-[var(--accent-dim)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:brightness-110 disabled:opacity-50"
          >
            ↓ Download .ics
          </button>
        </div>

        {loading ? (
          <p className="mt-10 text-[var(--muted)]">Loading schedule…</p>
        ) : !data ? null : (
          <>
            {/* KPIs */}
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Due today", String(data.dueToday)],
                ["Due this week", String(data.dueThisWeek)],
                ["Shifted for workload", String(data.shiftedCount)],
                ["Cards scheduled", String(data.items.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-4">
                  <p className="text-xs text-[var(--muted)]">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">{value}</p>
                </div>
              ))}
            </div>

            {/* Workload bars */}
            <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-5">
              <h2 className="font-[family-name:var(--font-display)] text-xl">Daily workload</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Reviews per day over the next weeks. The dashed line is your cap of {data.dailyCap}.
              </p>
              <div className="mt-5 flex items-end gap-1.5 overflow-x-auto" style={{ height: 150 }}>
                {data.perDay.map((d) => {
                  const over = d.count > data.dailyCap;
                  return (
                    <div key={d.dateMs} className="flex h-full min-w-[26px] flex-1 flex-col items-center gap-1">
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className={`w-full rounded-t ${over ? "bg-[var(--danger)]/70" : "bg-[var(--accent)]/70"}`}
                          style={{ height: `${Math.max(4, (d.count / maxDay) * 100)}%` }}
                          title={`${d.count} on ${fmtDay(d.dateMs)}`}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums text-[var(--muted)]">{d.count}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Upcoming table */}
            <h2 className="mt-10 font-[family-name:var(--font-display)] text-2xl">Upcoming reviews</h2>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="px-4 py-3 font-normal">Concept</th>
                    <th className="px-4 py-3 font-normal">Scheduled</th>
                    <th className="px-4 py-3 text-right font-normal">In</th>
                    <th className="px-4 py-3 text-right font-normal">Half-life</th>
                    <th className="px-4 py-3 text-right font-normal">Recall then</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.conceptId} className="border-b border-[var(--line)] last:border-0">
                      <td className="px-4 py-3">
                        <span className="text-[var(--ink)]">{it.title}</span>
                        {it.shifted && (
                          <span className="ml-2 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                            moved earlier
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">
                        {fmtDay(it.scheduledReviewAtMs)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--ink)]">
                        {fmtUntil(it.daysFromNow)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                        {it.halfLifeDays.toFixed(1)}d
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                        {Math.round(it.recallAtScheduled * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}
