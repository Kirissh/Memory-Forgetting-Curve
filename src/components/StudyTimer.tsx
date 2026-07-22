"use client";

import { useEffect, useRef, useState } from "react";

const FOCUS_OPTIONS = [15, 25, 50] as const;
const BREAK_MIN = 5;
const RING = 2 * Math.PI * 52; // circumference for r=52

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A local Pomodoro-style study timer — focus/break cycles, no server or accounts.
 * The lightweight version of "study together": ambient time-boxing while you grind.
 */
export function StudyTimer() {
  const [focusMin, setFocusMin] = useState(25);
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);

  // Mirror live state so the single interval reads fresh values without being a
  // dependency (which would tear down/recreate the interval every tick).
  const live = useRef({ secondsLeft, mode, focusMin });
  live.current = { secondsLeft, mode, focusMin };

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { secondsLeft: s, mode: m, focusMin: f } = live.current;
      if (s > 1) {
        setSecondsLeft(s - 1);
        return;
      }
      // Phase over: flip mode, refill, count a completed focus round. These are
      // plain setter calls in a timer callback (not inside a state updater), so
      // StrictMode does not double-run them.
      const next = m === "focus" ? "break" : "focus";
      setMode(next);
      setSecondsLeft((next === "focus" ? f : BREAK_MIN) * 60);
      if (m === "focus") setRounds((r) => r + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const total = (mode === "focus" ? focusMin : BREAK_MIN) * 60;
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - secondsLeft / total)) : 0;

  const pickFocus = (m: number) => {
    setFocusMin(m);
    // Only safe to retime while paused in a focus phase (avoids negative progress).
    if (mode === "focus" && !running) setSecondsLeft(m * 60);
  };

  const reset = () => {
    setRunning(false);
    setMode("focus");
    setSecondsLeft(focusMin * 60);
    setRounds(0);
  };

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Study timer
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Box your focus in {focusMin}-minute rounds with {BREAK_MIN}-minute
            breaks.
          </p>
        </div>
        <div className="flex gap-1 rounded-full border border-[var(--line)] p-1 text-xs">
          {FOCUS_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pickFocus(m)}
              disabled={running}
              aria-pressed={focusMin === m}
              className={`rounded-full px-3 py-1 transition-colors disabled:opacity-40 ${
                focusMin === m
                  ? "bg-[var(--accent)] font-medium text-[#0a1220]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-8">
        <div className="relative h-36 w-36">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="var(--line)"
              strokeWidth="8"
            />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke={mode === "focus" ? "var(--accent)" : "var(--ok)"}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - progress)}
              style={{ transition: "stroke-dashoffset 0.5s linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-[family-name:var(--font-display)] text-3xl tabular-nums">
              {mmss(secondsLeft)}
            </span>
            <span
              className={`text-xs uppercase tracking-[0.2em] ${
                mode === "focus" ? "text-[var(--accent)]" : "text-[var(--ok)]"
              }`}
            >
              {mode}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRunning((r) => !r)}
              className="btn-primary px-6 py-2.5 text-sm font-semibold"
            >
              {running ? "Pause" : "Start"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="btn-ghost px-5 py-2.5 text-sm"
            >
              Reset
            </button>
          </div>
          <p className="text-xs text-[var(--muted)] tabular-nums">
            {rounds} focus round{rounds === 1 ? "" : "s"} done today
          </p>
        </div>
      </div>
    </section>
  );
}
