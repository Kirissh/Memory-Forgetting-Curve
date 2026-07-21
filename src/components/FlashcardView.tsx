"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueueItem } from "./QueueList";
import { SessionSummary } from "./SessionSummary";
import { buildMeaningProbe, type MeaningProbe } from "@/lib/probes";

type Props = {
  deck: QueueItem[];
  onExit: () => void;
};

type Stage = "learn" | "bridge" | "test" | "done";

const DIFF_LABELS = ["", "Easy", "Light", "Okay", "Tough", "Brutal"];
const DIFF_COLORS = [
  "",
  "border-emerald-400/50 bg-emerald-400/15 text-emerald-300",
  "border-lime-400/50 bg-lime-400/15 text-lime-200",
  "border-amber-400/50 bg-amber-400/15 text-amber-200",
  "border-orange-400/50 bg-orange-400/15 text-orange-200",
  "border-rose-400/50 bg-rose-400/15 text-rose-300",
];

type LearnRecord = {
  cardId: string;
  conceptId: string;
  difficulty: number;
  readTimeMs: number;
  title: string;
  front: string;
  back: string;
};

type TestResult = {
  cardId: string;
  conceptId: string;
  title: string;
  correct: boolean;
  trapFailed: boolean;
  recallProbability: number;
  halfLifeDays: number;
  difficulty: number;
  why: string;
};

export function FlashcardView({ deck, onExit }: Props) {
  const [stage, setStage] = useState<Stage>("learn");
  const [learnIndex, setLearnIndex] = useState(0);
  const [testIndex, setTestIndex] = useState(0);
  const [learns, setLearns] = useState<LearnRecord[]>([]);
  const [testDeck, setTestDeck] = useState<QueueItem[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [pickedDiff, setPickedDiff] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<"probe" | "recall">("probe");
  const [answer, setAnswer] = useState("");
  const [graded, setGraded] = useState<{
    correct: boolean;
    similarity: number;
    target: string;
  } | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const encodeStartedAt = useRef(Date.now());
  const verifyStartedAt = useRef(0);

  const card = stage === "learn" ? deck[learnIndex] : testDeck[testIndex];
  const learnTotal = deck.length;

  const probe: MeaningProbe | null = useMemo(() => {
    if (stage !== "test" || testMode !== "probe" || !card) return null;
    return buildMeaningProbe(
      card.back || card.definition || "",
      card.cardId,
      `${sessionId}:t${testIndex}`
    );
  }, [stage, testMode, card, sessionId, testIndex]);

  useEffect(() => {
    if (stage === "learn") {
      encodeStartedAt.current = Date.now();
      setPickedDiff(null);
    } else if (stage === "test") {
      verifyStartedAt.current = Date.now();
      setFeedback(null);
      setAnswer("");
      setGraded(null);
    }
  }, [stage, learnIndex, testIndex]);

  const finishLearnCard = useCallback(
    async (difficulty: number) => {
      if (!card || busy || stage !== "learn") return;
      setBusy(true);
      setPickedDiff(difficulty);
      const readTimeMs = Date.now() - encodeStartedAt.current;
      try {
        await fetch("/api/encodings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: card.cardId,
            sessionId,
            readTimeMs,
            difficulty,
          }),
        });
        const record: LearnRecord = {
          cardId: card.cardId,
          conceptId: card.conceptId,
          difficulty,
          readTimeMs,
          title: card.title,
          front: card.front,
          back: card.back,
        };
        const nextLearns = [...learns, record];
        setLearns(nextLearns);

        await new Promise((r) => setTimeout(r, 280));

        if (learnIndex + 1 >= learnTotal) {
          // Rank test by hardness + time spent (hard + slow first)
          const ranked = [...deck].sort((a, b) => {
            const la = nextLearns.find((x) => x.cardId === a.cardId)!;
            const lb = nextLearns.find((x) => x.cardId === b.cardId)!;
            const scoreA = la.difficulty * 1e6 + la.readTimeMs;
            const scoreB = lb.difficulty * 1e6 + lb.readTimeMs;
            return scoreB - scoreA;
          });
          setTestDeck(ranked);
          setStage("bridge");
        } else {
          setLearnIndex((i) => i + 1);
          setPickedDiff(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, card, deck, learnIndex, learnTotal, learns, sessionId, stage]
  );

  const startTest = () => {
    setTestIndex(0);
    setResults([]);
    setStage("test");
  };

  // Shared tail for both test modes: record the result, then either advance to the
  // next card or (on the last one) retrain and pull fresh recall estimates.
  const advanceAfterResult = useCallback(
    async (nextResults: TestResult[]) => {
      setResults(nextResults);
      await new Promise((r) => setTimeout(r, 650));

      if (testIndex + 1 >= testDeck.length) {
        await fetch("/api/reviews", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retrain: true }),
        });
        try {
          const q = await fetch("/api/queue/today?limit=40").then((r) =>
            r.json()
          );
          const byId = new Map(
            (q.items || []).map((it: QueueItem) => [it.conceptId, it])
          );
          setResults(
            nextResults.map((r) => {
              const fresh = byId.get(r.conceptId) as QueueItem | undefined;
              if (!fresh) return r;
              return {
                ...r,
                recallProbability:
                  fresh.projectedRecall ?? fresh.recallProbability,
                halfLifeDays: fresh.halfLifeDays,
                why: fresh.why,
              };
            })
          );
        } catch {
          /* keep local */
        }
        setStage("done");
      } else {
        setTestIndex((i) => i + 1);
        setFeedback(null);
        setAnswer("");
        setGraded(null);
      }
    },
    [testIndex, testDeck.length]
  );

  const submitTest = useCallback(
    async (userSaidSameMeaning: boolean) => {
      if (!card || !probe || busy || stage !== "test") return;
      setBusy(true);
      const responseTimeMs = Date.now() - verifyStartedAt.current;
      const learn = learns.find((l) => l.cardId === card.cardId);
      try {
        const res = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: card.cardId,
            sessionId,
            readTimeMs: learn?.readTimeMs,
            responseTimeMs,
            probeWasSameMeaning: probe.isSameMeaning,
            userSaidSameMeaning,
            difficulty: learn?.difficulty,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const correct = userSaidSameMeaning === probe.isSameMeaning;

        if (data.trapFailed) {
          setFeedback("Trap — that meaning was altered.");
        } else if (correct) {
          setFeedback(
            probe.isSameMeaning
              ? "Yes — same meaning."
              : "Yes — you caught the rewrite."
          );
        } else {
          setFeedback(
            probe.isSameMeaning
              ? "Miss — that paraphrase was still true."
              : "Miss — the meaning had been changed."
          );
        }

        const nextResults: TestResult[] = [
          ...results,
          {
            cardId: card.cardId,
            conceptId: card.conceptId,
            title: card.title,
            correct,
            trapFailed: Boolean(data.trapFailed),
            recallProbability: card.recallProbability,
            halfLifeDays: card.halfLifeDays,
            difficulty: learn!.difficulty,
            why: card.why,
          },
        ];
        await advanceAfterResult(nextResults);
      } finally {
        setBusy(false);
      }
    },
    [advanceAfterResult, busy, card, learns, probe, results, sessionId, stage]
  );

  const submitRecall = useCallback(async () => {
    if (!card || busy || stage !== "test" || testMode !== "recall") return;
    if (!answer.trim()) return;
    setBusy(true);
    const responseTimeMs = Date.now() - verifyStartedAt.current;
    const learn = learns.find((l) => l.cardId === card.cardId);
    try {
      const g = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: card.cardId, answer }),
      }).then((r) => r.json());
      const correct = Boolean(g.correct);
      setGraded({
        correct,
        similarity: Number(g.similarity) || 0,
        target: g.target || card.back,
      });
      setFeedback(
        correct
          ? `Match — ${Math.round((g.similarity || 0) * 100)}% similar to the answer.`
          : `Off — only ${Math.round((g.similarity || 0) * 100)}% similar. See the answer below.`
      );

      await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId: card.cardId,
          sessionId,
          readTimeMs: learn?.readTimeMs,
          responseTimeMs,
          correct,
          difficulty: learn?.difficulty,
        }),
      });

      const nextResults: TestResult[] = [
        ...results,
        {
          cardId: card.cardId,
          conceptId: card.conceptId,
          title: card.title,
          correct,
          trapFailed: false,
          recallProbability: card.recallProbability,
          halfLifeDays: card.halfLifeDays,
          difficulty: learn!.difficulty,
          why: card.why,
        },
      ];
      await new Promise((r) => setTimeout(r, 900));
      await advanceAfterResult(nextResults);
    } finally {
      setBusy(false);
    }
  }, [advanceAfterResult, answer, busy, card, learns, results, sessionId, stage, testMode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy || stage === "done" || stage === "bridge") {
        if (e.key === "Escape") onExit();
        return;
      }
      if (e.key === "Escape") {
        onExit();
        return;
      }
      if (stage === "learn" && e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        finishLearnCard(Number(e.key));
      } else if (stage === "test" && testMode === "probe") {
        if (e.key === "1") {
          e.preventDefault();
          submitTest(false);
        } else if (e.key === "2") {
          e.preventDefault();
          submitTest(true);
        }
      } else if (stage === "test" && testMode === "recall") {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          submitRecall();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, finishLearnCard, onExit, stage, submitTest, submitRecall, testMode]);

  if (stage === "done") {
    const weak = [...results]
      .filter((r) => !r.correct || r.trapFailed || r.difficulty >= 4)
      .sort(
        (a, b) =>
          Number(!a.correct) - Number(!b.correct) ||
          b.difficulty - a.difficulty ||
          a.recallProbability - b.recallProbability
      );

    return (
      <SessionSummary
        reviewed={results.length}
        correct={results.filter((r) => r.correct).length}
        weakTopics={weak.map((w) => ({
          title: w.title,
          difficulty: w.difficulty,
          correct: w.correct,
          trapFailed: w.trapFailed,
          halfLifeDays: w.halfLifeDays,
          recallProbability: w.recallProbability,
          why: w.why,
        }))}
        onQueue={() => onExit()}
      />
    );
  }

  if (stage === "bridge") {
    const hard = learns.filter((l) => l.difficulty >= 4).length;
    const avgDiff =
      learns.reduce((s, l) => s + l.difficulty, 0) / Math.max(learns.length, 1);
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="eyebrow text-aurora">
          Step 4 · Ready to test
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          Check what <span className="text-aurora">stuck</span>.
        </h1>
        <p className="mt-4 max-w-md text-[var(--muted)]">
          Test order prioritizes slides you rated harder and spent longer
          reading — where forgetting risk is highest.
        </p>
        <div className="mt-8 grid w-full grid-cols-3 gap-3 text-sm">
          <div className="panel px-3 py-4">
            <p className="text-2xl font-[family-name:var(--font-display)]">
              {learns.length}
            </p>
            <p className="text-[var(--muted)]">learned</p>
          </div>
          <div className="panel px-3 py-4">
            <p className="text-2xl font-[family-name:var(--font-display)]">
              {avgDiff.toFixed(1)}
            </p>
            <p className="text-[var(--muted)]">avg hard</p>
          </div>
          <div className="panel px-3 py-4">
            <p className="text-2xl font-[family-name:var(--font-display)] text-[var(--danger)]">
              {hard}
            </p>
            <p className="text-[var(--muted)]">tough+</p>
          </div>
        </div>
        <div className="mt-8 w-full text-left">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Test mode
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTestMode("probe")}
              aria-pressed={testMode === "probe"}
              className={`rounded-2xl border px-3 py-3 text-sm transition ${
                testMode === "probe"
                  ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              Meaning check
              <span className="mt-0.5 block text-[10px] normal-case tracking-normal opacity-70">
                same / different — fast
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTestMode("recall")}
              aria-pressed={testMode === "recall"}
              className={`rounded-2xl border px-3 py-3 text-sm transition ${
                testMode === "recall"
                  ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              Free recall
              <span className="mt-0.5 block text-[10px] normal-case tracking-normal opacity-70">
                type it — graded by meaning
              </span>
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={startTest}
          className="btn-primary mt-6 w-full py-4 text-sm font-semibold"
        >
          Start {testMode === "recall" ? "free recall" : "meaning test"}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="mt-3 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Exit
        </button>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <p className="text-[var(--muted)]">No cards in this session.</p>
      </div>
    );
  }

  const progress =
    stage === "learn"
      ? ((learnIndex + (pickedDiff ? 0.5 : 0.2)) / learnTotal) * 50
      : 50 + ((testIndex + 0.4) / Math.max(testDeck.length, 1)) * 50;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6">
      <div className="mb-6 flex items-center justify-between text-sm text-[var(--muted)]">
        <button type="button" onClick={onExit} className="hover:text-[var(--ink)]">
          Esc · Exit
        </button>
        <span className="tabular-nums">
          {stage === "learn"
            ? `Learn ${learnIndex + 1}/${learnTotal}`
            : `Test ${testIndex + 1}/${testDeck.length}`}
        </span>
      </div>

      <div className="mb-2 flex gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
        <span className={stage === "learn" ? "text-[var(--accent)]" : ""}>
          2 Learn
        </span>
        <span>·</span>
        <span>3 Rate</span>
        <span>·</span>
        <span className={stage === "test" ? "text-[var(--accent)]" : ""}>
          4 Test
        </span>
        <span>·</span>
        <span>5 Weak topics</span>
      </div>

      <div className="mb-8 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
        <div
          className="h-full rounded-full bg-[image:var(--grad-aurora)] shadow-[0_0_16px_-2px_rgba(125,255,179,0.55)] transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div
        key={`${stage}-${card.cardId}`}
        className="relative flex-1 animate-[rise_0.4s_ease]"
      >
        {stage === "learn" ? (
          <div className="panel flex min-h-[340px] flex-col justify-center rounded-[1.75rem] px-8 py-12">
            <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              Flashcard
            </p>
            <p className="font-[family-name:var(--font-display)] text-center text-3xl leading-snug sm:text-4xl">
              {card.front}
            </p>
            <p className="mx-auto mt-8 max-w-xl text-center text-lg leading-relaxed text-[var(--ink)]/90 sm:text-xl">
              {card.back}
            </p>
          </div>
        ) : testMode === "recall" ? (
          <div className="panel flex min-h-[340px] flex-col items-center justify-center rounded-[1.75rem] px-8 py-12">
            <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              Recall it
            </p>
            <p className="font-[family-name:var(--font-display)] text-center text-2xl sm:text-3xl">
              {card.front}
            </p>
            {card.clozeText && (
              <p className="mt-4 max-w-xl text-center text-sm text-[var(--muted)]">
                Cloze:{" "}
                <span className="text-[var(--ink)]/80">{card.clozeText}</span>
              </p>
            )}
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={busy || graded != null}
              rows={3}
              placeholder="Type what you remember…"
              className="field mt-8 w-full max-w-xl resize-none px-5 py-4 text-lg leading-relaxed disabled:opacity-60"
            />
            {graded && (
              <div className="mt-5 w-full max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--bg-panel-2)] px-6 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  Actual answer
                </p>
                <p className="mt-2 text-center text-lg leading-relaxed">
                  {graded.target}
                </p>
              </div>
            )}
            {feedback && (
              <p
                className={`mt-5 text-sm ${
                  graded?.correct ? "text-[var(--ok)]" : "text-[var(--warn)]"
                }`}
              >
                {feedback}
              </p>
            )}
          </div>
        ) : (
          <div className="panel flex min-h-[340px] flex-col items-center justify-center rounded-[1.75rem] px-8 py-12">
            <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              Same meaning?
            </p>
            <p className="font-[family-name:var(--font-display)] text-center text-2xl sm:text-3xl">
              {card.front}
            </p>
            <div className="mt-8 w-full max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--bg-panel-2)] px-6 py-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                Claimed explanation
              </p>
              <p className="mt-3 text-center text-lg leading-relaxed sm:text-xl">
                {probe?.statement}
              </p>
            </div>
            {feedback && (
              <p className="mt-6 text-sm text-[var(--warn)]">{feedback}</p>
            )}
          </div>
        )}
      </div>

      {stage === "learn" ? (
        <div className="mt-8 space-y-3">
          <p className="text-center text-sm text-[var(--muted)]">
            How hard was this to understand?{" "}
            <span className="text-[var(--ink)]/70">(1–5)</span>
          </p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy}
                onClick={() => finishLearnCard(d)}
                className={`group relative overflow-hidden rounded-2xl border py-4 transition duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.97] disabled:opacity-50 ${
                  DIFF_COLORS[d]
                } ${pickedDiff === d ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)] scale-[1.03]" : ""}`}
              >
                <span className="block font-[family-name:var(--font-display)] text-2xl">
                  {d}
                </span>
                <span className="mt-1 block text-[10px] uppercase tracking-wider opacity-80">
                  {DIFF_LABELS[d]}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : testMode === "recall" ? (
        <div className="mt-8">
          <button
            type="button"
            disabled={busy || !answer.trim() || graded != null}
            onClick={() => submitRecall()}
            className="btn-soft w-full py-4 text-sm font-medium disabled:opacity-50"
          >
            {graded ? "Saved…" : "Submit answer"}{" "}
            <span className="opacity-60">(⌘↵)</span>
          </button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => submitTest(false)}
            className="rounded-full border border-[var(--danger)]/40 bg-[var(--danger-dim)] py-4 text-sm font-medium text-[var(--danger)] transition hover:-translate-y-0.5 hover:brightness-110 disabled:opacity-50"
          >
            Different <span className="opacity-60">(1)</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submitTest(true)}
            className="btn-soft py-4 text-sm font-medium disabled:opacity-50"
          >
            Same meaning <span className="opacity-60">(2)</span>
          </button>
        </div>
      )}
    </div>
  );
}
