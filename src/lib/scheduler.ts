/**
 * Review scheduler for the Recall forgetting-curve app.
 *
 * Memory decays as P(recall) = 2^(-Δt/h), where h is the half-life in days
 * (Half-Life Regression; Settles & Meeder, ACL 2016). Given a half-life and an
 * anchor time (when the memory was last reinforced), a card's *ideal* review is
 * the moment recall falls to a target retention: solving the curve gives
 * t_days = h · (-log2(target)) (e.g. target 0.9 → ≈ 0.152·h).
 *
 * This module turns those per-card ideals into a concrete calendar: it buckets
 * reviews into UTC days, spreads overload across earlier days so no single day
 * blows past a soft daily cap, and emits an .ics feed. Everything is pure and
 * deterministic — "now" is always passed in as `nowMs`, never read from the clock —
 * so the schedule is reproducible and unit-testable.
 */

const MS_PER_DAY = 86400000;

/** Keep a value inside [lo, hi]; also collapses NaN to lo. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.min(Math.max(x, lo), hi);
}

/** A finite ms value for Date math; non-finite inputs fall back to epoch. */
function safeMs(ms: number): number {
  return Number.isFinite(ms) ? ms : 0;
}

export interface ScheduleInput {
  conceptId: string;
  title: string;
  halfLifeDays: number;
  anchorMs: number;
}

export interface ScheduleItem {
  conceptId: string;
  title: string;
  halfLifeDays: number;
  anchorMs: number;
  idealReviewAtMs: number;
  scheduledReviewAtMs: number;
  targetRetention: number;
  recallAtScheduled: number;
  daysFromNow: number;
  shifted: boolean;
}

export interface ScheduleResult {
  items: ScheduleItem[];
  perDay: { dateMs: number; count: number }[];
  targetRetention: number;
  dailyCap: number;
}

/**
 * The instant recall decays to `target`, in ms. Inverting 2^(-Δt/h) = target
 * gives Δt = h · (-log2(target)). Guards: h ≥ 0.1 (avoid divide-by-zero on a
 * degenerate half-life) and target in (0,1) (log2 of 0/1 is ±∞/0).
 */
export function idealReviewAtMs(
  halfLifeDays: number,
  anchorMs: number,
  target: number
): number {
  const h = Math.max(halfLifeDays, 0.1);
  const t = clamp(target, 0.01, 0.99);
  const tDays = h * -Math.log2(t);
  return safeMs(anchorMs) + tDays * MS_PER_DAY;
}

/** Internal working record while we assign each card to a day bucket. */
interface Work {
  input: ScheduleInput;
  h: number;
  idealMsRaw: number; // unclamped ideal instant (may be in the past)
  idealMs: number; // clamped to ≥ nowMs — never schedule a review in the past
  idealDayRaw: number; // day index the ideal lands on, before horizon capping
  dayIndex: number; // currently assigned day index (mutated by spreading)
  shifted: boolean;
}

/** Earliest day in [0, dayExclusive) that still has room under the cap, or -1. */
function earliestDayWithRoom(
  count: Map<number, number>,
  dayExclusive: number,
  cap: number
): number {
  for (let p = 0; p < dayExclusive; p++) {
    if ((count.get(p) ?? 0) < cap) return p;
  }
  return -1;
}

/**
 * Build a workload-aware review schedule.
 *
 * 1. Each card's ideal review is clamped to ≥ now (overdue cards land today).
 * 2. Ideals are floored to UTC-midnight day buckets, measured from now's day.
 *    Cards whose ideal sits past the planning horizon are pulled forward to the
 *    horizon's edge (reviewing early is safe; reviewing never is not).
 * 3. Days are walked ascending; any day over `dailyCap` sheds its LEAST urgent
 *    overflow (urgency = soonest ideal, then shortest half-life — the most
 *    fragile cards keep their slot). Overflow can only move EARLIER, never past
 *    its ideal, so it drops onto the earliest preceding day with spare capacity.
 *    If nothing earlier has room the cap is treated as soft: the card stays put.
 *    Any card that ends up off its ideal day is flagged `shifted`.
 */
export function scheduleWithWorkload(
  inputs: ScheduleInput[],
  opts: {
    targetRetention?: number;
    dailyCap?: number;
    nowMs: number;
    horizonDays?: number;
  }
): ScheduleResult {
  const target = clamp(opts.targetRetention ?? 0.9, 0.01, 0.99);
  // Cap must be ≥ 1 or every day "overflows" and spreading never terminates sensibly.
  const cap = Math.max(1, Math.floor(opts.dailyCap ?? 20));
  const horizon = Math.max(0, Math.floor(opts.horizonDays ?? 60));
  const nowMs = safeMs(opts.nowMs);
  // Day 0 is the UTC midnight of now's day (epoch is itself UTC midnight).
  const nowMidnight = Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY;

  const work: Work[] = inputs.map((it) => {
    const h = Math.max(it.halfLifeDays, 0.1);
    const idealMsRaw = idealReviewAtMs(it.halfLifeDays, it.anchorMs, target);
    const idealMs = Math.max(idealMsRaw, nowMs);
    const idealDayRaw = Math.max(
      0,
      Math.floor((idealMs - nowMidnight) / MS_PER_DAY)
    );
    const dayIndex = Math.min(idealDayRaw, horizon);
    return {
      input: it,
      h,
      idealMsRaw,
      idealMs,
      idealDayRaw,
      dayIndex,
      // Capping to the horizon already moves it off its true ideal day.
      shifted: dayIndex !== idealDayRaw,
    };
  });

  // Live per-day occupancy, kept in sync as cards are relocated.
  const count = new Map<number, number>();
  for (const w of work) count.set(w.dayIndex, (count.get(w.dayIndex) ?? 0) + 1);

  // Most urgent first: soonest ideal, ties broken by shortest half-life.
  const byUrgency = (a: Work, b: Work): number =>
    a.idealMs - b.idealMs || a.h - b.h;

  const maxDay = work.reduce((m, w) => Math.max(m, w.dayIndex), 0);

  for (let day = 0; day <= maxDay; day++) {
    const bucket = work.filter((w) => w.dayIndex === day);
    if (bucket.length <= cap) continue;
    bucket.sort(byUrgency);
    // The first `cap` (most urgent) keep their slot; the rest must move earlier.
    // Iterating overflow in urgency order lets the more fragile ones grab the
    // nearest free days first.
    const overflow = bucket.slice(cap);
    for (const w of overflow) {
      w.shifted = true;
      const dest = earliestDayWithRoom(count, day, cap);
      if (dest >= 0) {
        count.set(day, (count.get(day) ?? 1) - 1);
        count.set(dest, (count.get(dest) ?? 0) + 1);
        w.dayIndex = dest;
      }
      // else: no earlier room — soft cap, keep it here (already flagged shifted).
    }
  }

  const items: ScheduleItem[] = work.map((w) => {
    const scheduledMs = nowMidnight + w.dayIndex * MS_PER_DAY;
    // Age at review, floored at 0 so recall can't exceed 1 for a same-day slot.
    const deltaDays = Math.max(0, (scheduledMs - safeMs(w.input.anchorMs)) / MS_PER_DAY);
    const recall = Math.pow(2, -deltaDays / Math.max(w.h, 0.1));
    return {
      conceptId: w.input.conceptId,
      title: w.input.title,
      halfLifeDays: w.input.halfLifeDays,
      anchorMs: w.input.anchorMs,
      idealReviewAtMs: w.idealMsRaw,
      scheduledReviewAtMs: scheduledMs,
      targetRetention: target,
      recallAtScheduled: clamp(recall, 0, 1),
      daysFromNow: (scheduledMs - nowMs) / MS_PER_DAY,
      shifted: w.shifted,
    };
  });

  const perDay = Array.from(count.entries())
    .filter(([, c]) => c > 0)
    .map(([dayIndex, c]) => ({
      dateMs: nowMidnight + dayIndex * MS_PER_DAY,
      count: c,
    }))
    .sort((a, b) => a.dateMs - b.dateMs);

  return { items, perDay, targetRetention: target, dailyCap: cap };
}

/** Two-digit zero-pad for calendar fields. */
function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** UTC instant as iCalendar YYYYMMDDTHHMMSSZ. */
function formatUtcTimestamp(ms: number): string {
  const d = new Date(safeMs(ms));
  return (
    String(d.getUTCFullYear()) +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

/** UTC date as iCalendar YYYYMMDD (for VALUE=DATE all-day events). */
function formatUtcDate(ms: number): string {
  const d = new Date(safeMs(ms));
  return (
    String(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate())
  );
}

/** Escape the RFC 5545 specials in a text value: backslash, newline, comma, semicolon. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Fold a content line to ≤75 octets per RFC 5545. Continuation lines are
 * prefixed with a space; callers join the pieces with CRLF. Approximated on
 * characters (fine for the ASCII-dominant fields we emit here).
 */
function foldLine(line: string): string[] {
  const max = 74;
  if (line.length <= max) return [line];
  const out: string[] = [line.slice(0, max)];
  for (let i = max; i < line.length; i += max - 1) {
    out.push(" " + line.slice(i, i + (max - 1)));
  }
  return out;
}

/**
 * Serialize scheduled items as a VCALENDAR feed — one all-day VEVENT per card on
 * its scheduled day. Timestamps are UTC; `nowMs` (not the wall clock) stamps
 * DTSTAMP so the output is deterministic. Text is escaped and folded minimally.
 */
export function buildIcs(
  items: ScheduleItem[],
  nowMs: number,
  opts?: { calName?: string }
): string {
  const calName = opts?.calName ?? "Recall Reviews";
  const dtstamp = formatUtcTimestamp(nowMs);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Recall//Forgetting-Curve Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...foldLine("X-WR-CALNAME:" + escapeText(calName)),
  ];

  for (const it of items) {
    const pct = Math.round(clamp(it.targetRetention, 0, 1) * 100);
    lines.push("BEGIN:VEVENT");
    lines.push(...foldLine("UID:" + escapeText(it.conceptId) + "@recall"));
    lines.push("DTSTAMP:" + dtstamp);
    lines.push("DTSTART;VALUE=DATE:" + formatUtcDate(it.scheduledReviewAtMs));
    lines.push(...foldLine("SUMMARY:Recall: " + escapeText(it.title)));
    lines.push(
      ...foldLine(
        "DESCRIPTION:Review to hold recall at or above " +
          pct +
          "% (target retention " +
          it.targetRetention.toFixed(2) +
          ")."
      )
    );
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
