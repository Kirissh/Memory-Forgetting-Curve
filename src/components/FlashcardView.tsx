"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueueItem } from "./QueueList";
import { SessionSummary } from "./SessionSummary";
import {
  buildMeaningProbe,
  buildPokerRound,
  type MeaningProbe,
  type PokerRound,
} from "@/lib/probes";
import { STARTING_POKER_CREDITS } from "@/lib/types";
import {
  POKER_BOTS,
  initialBotStacks,
  resolveBotHands,
  type BotHandResult,
  type BotStackState,
} from "@/lib/pokerBots";

type Props = {
  deck: QueueItem[];
  onExit: () => void;
};

type Stage = "learn" | "bridge" | "test" | "done";
type TestMode = "probe" | "recall" | "poker";

const DIFF_LABELS = ["", "Easy", "Light", "Okay", "Tough", "Brutal"];
const DIFF_COLORS = [
  "",
  "border-emerald-400/50 bg-emerald-400/15 text-emerald-300",
  "border-lime-400/50 bg-lime-400/15 text-lime-200",
  "border-amber-400/50 bg-amber-400/15 text-amber-200",
  "border-orange-400/50 bg-orange-400/15 text-orange-200",
  "border-rose-400/50 bg-rose-400/15 text-rose-300",
];

const STAKE_OPTIONS = [10, 25, 50, 100] as const;

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
  totalReviews?: number;
  chipDelta?: number;
};

function AttemptBadge({ item }: { item: QueueItem }) {
  const attempts = item.totalReviews ?? 0;
  const misses = item.incorrectCount ?? 0;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
      <span
        title="The model learns your forgetting pattern from attempts — more is better"
        className="chip px-2.5 py-1 tabular-nums"
      >
        {attempts} attempt{attempts === 1 ? "" : "s"}
        {attempts < 5 ? " · keep going" : ""}
      </span>
      {misses > 0 && (
        <span className="chip bg-[var(--danger-dim)] px-2.5 py-1 tabular-nums text-[var(--danger)]">
          {misses} miss{misses === 1 ? "" : "es"}
        </span>
      )}
      {(item.learnCount ?? 0) > 0 && (
        <span className="chip px-2.5 py-1 tabular-nums text-[var(--muted)]">
          learned {item.learnCount}×
        </span>
      )}
    </div>
  );
}

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
  const [testMode, setTestMode] = useState<TestMode>("probe");
  const [answer, setAnswer] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [graded, setGraded] = useState<{
    correct: boolean;
    similarity: number;
    target: string;
  } | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const encodeStartedAt = useRef(Date.now());
  const verifyStartedAt = useRef(0);
  const flipRevealedAt = useRef<number | null>(null);

  // Poker table state
  const [credits, setCredits] = useState(STARTING_POKER_CREDITS);
  const [stake, setStake] = useState<number>(25);
  const [pickedChoice, setPickedChoice] = useState<string | null>(null);
  const [pokerResolved, setPokerResolved] = useState(false);
  const [sessionDelta, setSessionDelta] = useState(0);
  const [botStacks, setBotStacks] = useState<BotStackState>(() =>
    initialBotStacks(STARTING_POKER_CREDITS)
  );
  const [botHand, setBotHand] = useState<BotHandResult[] | null>(null);

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

  const poker: PokerRound | null = useMemo(() => {
    if (stage !== "test" || testMode !== "poker" || !card) return null;
    return buildPokerRound(
      card.back || card.definition || "",
      card.cardId,
      `${sessionId}:p${testIndex}`
    );
  }, [stage, testMode, card, sessionId, testIndex]);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        const c = Number(d?.user?.pokerCredits);
        if (Number.isFinite(c) && c > 0) setCredits(Math.round(c));
      })
      .catch(() => {
        /* keep default */
      });
  }, []);

  useEffect(() => {
    if (stage === "learn") {
      encodeStartedAt.current = Date.now();
      flipRevealedAt.current = null;
      setPickedDiff(null);
      setFlipped(false);
    } else if (stage === "test") {
      verifyStartedAt.current = Date.now();
      setFeedback(null);
      setAnswer("");
      setGraded(null);
      setPickedChoice(null);
      setPokerResolved(false);
      setFlipped(false);
      setBotHand(null);
    }
  }, [stage, learnIndex, testIndex]);

  const persistCredits = useCallback(async (next: number) => {
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pokerCredits: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data.pokerCredits === "number") {
        setCredits(data.pokerCredits);
      }
    } catch {
      /* local balance still shown */
    }
  }, []);

  const finishLearnCard = useCallback(
    async (difficulty: number) => {
      if (!card || busy || stage !== "learn" || !flipped) return;
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
    [busy, card, deck, flipped, learnIndex, learnTotal, learns, sessionId, stage]
  );

  const startTest = () => {
    setTestIndex(0);
    setResults([]);
    setSessionDelta(0);
    setBotHand(null);
    if (testMode === "poker") {
      setBotStacks(initialBotStacks(STARTING_POKER_CREDITS));
      if (credits < 50) {
        setCredits(STARTING_POKER_CREDITS);
      }
    }
    setStage("test");
  };

  const advanceAfterResult = useCallback(
    async (nextResults: TestResult[], finalCredits?: number) => {
      setResults(nextResults);
      await new Promise((r) => setTimeout(r, 650));

      if (testIndex + 1 >= testDeck.length) {
        await fetch("/api/reviews", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retrain: true }),
        });
        if (typeof finalCredits === "number") {
          await persistCredits(finalCredits);
        } else if (testMode === "poker") {
          await persistCredits(credits);
        }
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
                totalReviews: fresh.totalReviews,
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
        setPickedChoice(null);
        setPokerResolved(false);
        setBotHand(null);
      }
    },
    [credits, persistCredits, testIndex, testDeck.length, testMode]
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
          setFeedback(
            `Trap — the summary was inverted. True gist: ${probe.trueSummary}`
          );
        } else if (correct) {
          setFeedback(
            probe.isSameMeaning
              ? "Yes — that summary matched."
              : "Yes — you caught the opposite meaning."
          );
        } else {
          setFeedback(
            probe.isSameMeaning
              ? `Miss — that paraphrase was still true. Gist: ${probe.trueSummary}`
              : `Miss — meaning had been flipped. True gist: ${probe.trueSummary}`
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
            totalReviews: (card.totalReviews ?? 0) + 1,
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
          totalReviews: (card.totalReviews ?? 0) + 1,
        },
      ];
      await new Promise((r) => setTimeout(r, 900));
      await advanceAfterResult(nextResults);
    } finally {
      setBusy(false);
    }
  }, [
    advanceAfterResult,
    answer,
    busy,
    card,
    learns,
    results,
    sessionId,
    stage,
    testMode,
  ]);

  const submitPoker = useCallback(async () => {
    if (!card || !poker || busy || stage !== "test" || testMode !== "poker")
      return;
    if (!pickedChoice || pokerResolved) return;
    const bet = Math.min(stake, credits);
    if (bet <= 0) {
      setFeedback("You're out of chips — soft rebuy on next session.");
      return;
    }

    setBusy(true);
    const responseTimeMs = Date.now() - verifyStartedAt.current;
    const learn = learns.find((l) => l.cardId === card.cardId);
    const choice = poker.choices.find((c) => c.id === pickedChoice);
    const correct = Boolean(choice?.correct);
    // Even-money: win +bet or lose −bet
    const delta = correct ? bet : -bet;
    const nextCredits = Math.max(0, credits + delta);

    const { results: botResults, nextStacks } = resolveBotHands({
      handKey: `${sessionId}:${card.cardId}:${testIndex}`,
      choices: poker.choices,
      userStake: bet,
      stacks: botStacks,
    });

    try {
      setPokerResolved(true);
      setBotHand(botResults);
      setBotStacks(nextStacks);
      setCredits(nextCredits);
      setSessionDelta((d) => d + delta);

      const botsRight = botResults.filter((b) => b.correct).length;
      setFeedback(
        correct
          ? `You won +${bet} · ${botsRight}/4 bots also hit · ${poker.trueSummary}`
          : `You lost −${bet} · ${botsRight}/4 bots hit · True: ${poker.trueSummary}`
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
          betAmount: bet,
          chipDelta: delta,
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
          totalReviews: (card.totalReviews ?? 0) + 1,
          chipDelta: delta,
        },
      ];
      await new Promise((r) => setTimeout(r, 1600));
      await advanceAfterResult(nextResults, nextCredits);
    } finally {
      setBusy(false);
    }
  }, [
    advanceAfterResult,
    botStacks,
    busy,
    card,
    credits,
    learns,
    pickedChoice,
    poker,
    pokerResolved,
    results,
    sessionId,
    stage,
    stake,
    testIndex,
    testMode,
  ]);

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
      if (stage === "learn") {
        if (e.key === " " || e.key === "Enter") {
          if (!flipped) {
            e.preventDefault();
            setFlipped(true);
            flipRevealedAt.current = Date.now();
          }
        } else if (flipped && e.key >= "1" && e.key <= "5") {
          e.preventDefault();
          finishLearnCard(Number(e.key));
        }
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
      } else if (stage === "test" && testMode === "poker") {
        const map: Record<string, string> = {
          a: "A",
          b: "B",
          c: "C",
          d: "D",
          "1": "A",
          "2": "B",
          "3": "C",
          "4": "D",
        };
        const pick = map[e.key.toLowerCase()];
        if (pick && !pokerResolved) {
          e.preventDefault();
          setPickedChoice(pick);
        } else if (e.key === "Enter" && pickedChoice && !pokerResolved) {
          e.preventDefault();
          submitPoker();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    busy,
    finishLearnCard,
    flipped,
    onExit,
    pickedChoice,
    pokerResolved,
    stage,
    submitPoker,
    submitRecall,
    submitTest,
    testMode,
  ]);

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
        pokerDelta={testMode === "poker" ? sessionDelta : undefined}
        pokerCredits={testMode === "poker" ? credits : undefined}
        pokerStandings={
          testMode === "poker"
            ? [
                { name: "You", stack: credits },
                ...POKER_BOTS.map((b) => ({
                  name: b.name,
                  stack: botStacks[b.id],
                })),
              ].sort((a, b) => b.stack - a.stack)
            : undefined
        }
        weakTopics={weak.map((w) => ({
          title: w.title,
          difficulty: w.difficulty,
          correct: w.correct,
          trapFailed: w.trapFailed,
          halfLifeDays: w.halfLifeDays,
          recallProbability: w.recallProbability,
          why: w.why,
          totalReviews: w.totalReviews,
        }))}
        onQueue={() => onExit()}
      />
    );
  }

  if (stage === "bridge") {
    const hard = learns.filter((l) => l.difficulty >= 4).length;
    const avgDiff =
      learns.reduce((s, l) => s + l.difficulty, 0) / Math.max(learns.length, 1);
    const avgReadSec =
      learns.reduce((s, l) => s + l.readTimeMs, 0) /
      Math.max(learns.length, 1) /
      1000;
    const thinHistory = deck.filter((d) => (d.totalReviews ?? 0) < 5).length;

    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="eyebrow text-aurora">Step 4 · Ready to test</p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          Check what <span className="text-aurora">stuck</span>.
        </h1>
        <p className="mt-4 max-w-md text-[var(--muted)]">
          Read time (~{avgReadSec.toFixed(1)}s avg) and answer speed both feed
          the retention model — slow retrieval usually means a shorter half-life.
        </p>
        {thinHistory > 0 && (
          <p className="mt-3 max-w-md text-sm text-[var(--accent)]">
            {thinHistory} topic{thinHistory === 1 ? "" : "s"} still have few
            attempts. More checks = clearer forget map.
          </p>
        )}
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                {
                  id: "probe" as const,
                  title: "Meaning check",
                  blurb: "summary vs opposite",
                },
                {
                  id: "recall" as const,
                  title: "Free recall",
                  blurb: "type it from memory",
                },
                {
                  id: "poker" as const,
                  title: "Poker table",
                  blurb: `vs Kirissh · Arnav · Harshith · Sai`,
                },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setTestMode(m.id)}
                aria-pressed={testMode === m.id}
                className={`rounded-2xl border px-3 py-3 text-sm transition ${
                  testMode === m.id
                    ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {m.title}
                <span className="mt-0.5 block text-[10px] normal-case tracking-normal opacity-70">
                  {m.blurb}
                </span>
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={startTest}
          className="btn-primary mt-6 w-full py-4 text-sm font-semibold"
        >
          Start{" "}
          {testMode === "recall"
            ? "free recall"
            : testMode === "poker"
              ? "poker table"
              : "meaning test"}
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
      ? ((learnIndex + (pickedDiff ? 0.5 : flipped ? 0.35 : 0.15)) /
          learnTotal) *
        50
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
          {stage === "test" && testMode === "poker" && (
            <span className="ml-3 text-[var(--accent)]">{credits} chips</span>
          )}
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
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div
        key={`${stage}-${card.cardId}`}
        className="relative flex-1 animate-[rise_0.4s_ease]"
      >
        {stage === "learn" ? (
          <div className="card-flip-scene">
            <AttemptBadge item={card} />
            <div
              role="button"
              tabIndex={0}
              aria-label={flipped ? "Card back showing" : "Flip card"}
              onClick={() => {
                if (!flipped) {
                  setFlipped(true);
                  flipRevealedAt.current = Date.now();
                }
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !flipped) {
                  e.preventDefault();
                  setFlipped(true);
                  flipRevealedAt.current = Date.now();
                }
              }}
              className={`card-flip ${flipped ? "is-flipped" : ""}`}
            >
              <div className="card-face panel">
                <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                  Front · tap or Space to flip
                </p>
                <p className="font-[family-name:var(--font-display)] text-center text-3xl leading-snug sm:text-4xl">
                  {card.front}
                </p>
              </div>
              <div className="card-face card-back panel">
                <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                  Back
                </p>
                <p className="mx-auto max-w-xl text-center text-lg leading-relaxed text-[var(--ink)]/90 sm:text-xl">
                  {card.back}
                </p>
              </div>
            </div>
          </div>
        ) : testMode === "recall" ? (
          <div className="panel flex min-h-[340px] flex-col items-center justify-center rounded-[1.75rem] px-8 py-12">
            <AttemptBadge item={card} />
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
        ) : testMode === "poker" ? (
          <div className="poker-felt panel flex min-h-[340px] flex-col items-center rounded-[1.75rem] px-5 py-8 sm:px-8">
            <AttemptBadge item={card} />
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              Poker table · 5-handed
            </p>

            {/* Rival seats */}
            <div className="mt-4 grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
              {POKER_BOTS.map((bot) => {
                const hand = botHand?.find((h) => h.botId === bot.id);
                const stack = hand?.stack ?? botStacks[bot.id];
                return (
                  <div key={bot.id} className="poker-seat">
                    <div className="flex items-center gap-2">
                      <span
                        className="poker-avatar"
                        style={{ background: bot.color }}
                        aria-hidden
                      >
                        {bot.name.slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {bot.name}
                        </p>
                        <p className="truncate text-[10px] text-[var(--muted)]">
                          {bot.tagline}
                        </p>
                      </div>
                    </div>
                    <p
                      className="mt-2 text-sm tabular-nums"
                      style={{ color: bot.color }}
                    >
                      {stack} chips
                    </p>
                    {pokerResolved && hand ? (
                      <p
                        className={`mt-1 text-xs tabular-nums ${
                          hand.correct ? "text-[var(--ok)]" : "text-[var(--danger)]"
                        }`}
                      >
                        {hand.choiceId} · {hand.delta > 0 ? "+" : ""}
                        {hand.delta}
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        waiting…
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pot / you */}
            <div className="poker-pot mt-5 w-full max-w-md text-center">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                You
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-xl text-[var(--accent)] tabular-nums">
                {credits} chips
                {sessionDelta !== 0 && (
                  <span
                    className={`ml-2 text-sm ${
                      sessionDelta > 0
                        ? "text-[var(--ok)]"
                        : "text-[var(--danger)]"
                    }`}
                  >
                    ({sessionDelta > 0 ? "+" : ""}
                    {sessionDelta})
                  </span>
                )}
              </p>
            </div>

            <p className="mt-5 font-[family-name:var(--font-display)] text-center text-2xl sm:text-3xl">
              {card.front}
            </p>
            <p className="mt-2 text-center text-sm text-[var(--muted)]">
              {poker?.prompt}
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                Your stake
              </span>
              {STAKE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy || pokerResolved || s > credits}
                  onClick={() => setStake(s)}
                  className={`poker-chip ${stake === s ? "is-active" : ""} disabled:opacity-40`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="mt-5 grid w-full max-w-xl gap-2">
              {poker?.choices.map((c) => {
                let cls = "poker-choice";
                if (pickedChoice === c.id) cls += " is-picked";
                if (pokerResolved) {
                  if (c.correct) cls += " is-correct";
                  else if (pickedChoice === c.id) cls += " is-wrong";
                }
                const botPicks =
                  pokerResolved && botHand
                    ? botHand.filter((h) => h.choiceId === c.id)
                    : [];
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy || pokerResolved}
                    onClick={() => setPickedChoice(c.id)}
                    className={cls}
                  >
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-xs font-semibold text-[var(--muted)]">
                        {c.id}
                      </span>
                      <span className="flex-1 text-left">{c.text}</span>
                    </span>
                    {botPicks.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {botPicks.map((b) => (
                          <span
                            key={b.botId}
                            className="rounded-full px-2 py-0.5 text-[10px]"
                            style={{
                              background: `${b.color}33`,
                              color: b.color,
                            }}
                          >
                            {b.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Live standings */}
            <div className="mt-5 w-full max-w-xl">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Standings
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {[
                  { name: "You", stack: credits, color: "var(--accent)" },
                  ...POKER_BOTS.map((b) => ({
                    name: b.name,
                    stack: botStacks[b.id],
                    color: b.color,
                  })),
                ]
                  .sort((a, b) => b.stack - a.stack)
                  .map((row, i) => (
                    <span
                      key={row.name}
                      className="chip px-2.5 py-1 tabular-nums"
                      style={{ borderColor: row.color, color: row.color }}
                    >
                      #{i + 1} {row.name} · {row.stack}
                    </span>
                  ))}
              </div>
            </div>

            {feedback && (
              <p
                className={`mt-5 max-w-xl text-center text-sm ${
                  feedback.startsWith("You won")
                    ? "text-[var(--ok)]"
                    : "text-[var(--warn)]"
                }`}
              >
                {feedback}
              </p>
            )}
          </div>
        ) : (
          <div className="panel flex min-h-[340px] flex-col items-center justify-center rounded-[1.75rem] px-8 py-12">
            <AttemptBadge item={card} />
            <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              Same meaning?
            </p>
            <p className="font-[family-name:var(--font-display)] text-center text-2xl sm:text-3xl">
              {card.front}
            </p>
            <div className="mt-8 w-full max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--bg-panel-2)] px-6 py-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                Claimed summary
              </p>
              <p className="mt-3 text-center text-lg leading-relaxed sm:text-xl">
                {probe?.statement}
              </p>
            </div>
            {feedback && (
              <p className="mt-6 max-w-xl text-center text-sm text-[var(--warn)]">
                {feedback}
              </p>
            )}
          </div>
        )}
      </div>

      {stage === "learn" ? (
        <div className="mt-8 space-y-3">
          {!flipped ? (
            <p className="text-center text-sm text-[var(--muted)]">
              Flip the card when you&apos;re ready to see the answer
            </p>
          ) : (
            <>
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
            </>
          )}
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
      ) : testMode === "poker" ? (
        <div className="mt-8">
          <button
            type="button"
            disabled={busy || !pickedChoice || pokerResolved || credits <= 0}
            onClick={() => submitPoker()}
            className="btn-primary w-full py-4 text-sm font-semibold disabled:opacity-50"
          >
            {pokerResolved
              ? "Dealing next…"
              : `Lock in · bet ${Math.min(stake, credits)} (↵)`}
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
