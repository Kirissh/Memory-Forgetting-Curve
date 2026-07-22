import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";

const PIPELINE = [
  {
    n: "01",
    title: "Log a study event",
    body: "Each learn + test leaves a trail: dwell time, ease-of-learning (1–5), answer latency, correct/miss, trap fails. That’s the raw signal — not a vibe check.",
  },
  {
    n: "02",
    title: "Build a feature vector x",
    body: "Streaks, misses, log review count, spacing of past reviews, embedding similarity to known concepts, read/response times, difficulty, night-study / cram / routine rates. All from prior history only.",
  },
  {
    n: "03",
    title: "Predict half-life h",
    body: "h = exp(w · x). Longer h means the memory decays slower. w is personalized per user; cold start uses a hand-tuned prior (~3-day baseline).",
  },
  {
    n: "04",
    title: "Sample the forgetting curve",
    body: "P(recall) = 2^(−Δt / h). Δt is when we look — days since last review — not a feature inside w. Queue ranks fade risk; curve solves when P crosses your threshold.",
  },
  {
    n: "05",
    title: "Fit by maximum likelihood",
    body: "Each review is a Bernoulli outcome. We maximize log-likelihood under that curve (Adam, standardized features), with a Gaussian pull toward the prior so sparse data doesn’t explode.",
  },
  {
    n: "06",
    title: "Retrain → rank → explain",
    body: "End of session refits w. Today’s Queue re-ranks by projected fade. “Why” lines come from top wᵢxᵢ contributions. Insights bake-off vs prior, SM-2, and FSRS on held-out reviews.",
  },
] as const;

const FEATURES = [
  ["bias", "Baseline half-life (~3 days cold start)"],
  ["correct_streak", "Consecutive hits strengthen the trace"],
  ["incorrect_count", "Cumulative misses shorten half-life"],
  ["log_total_reviews", "More practice → more signal (+ usually stronger)"],
  ["avg_days_between_reviews", "Historical spacing of past reviews"],
  ["concept_embedding_similarity", "Related topics you already know"],
  ["log_read_time", "Careful encoding while learning"],
  ["log_response_time", "Slow retrieval ≈ weaker memory"],
  ["trap_fail_rate", "Failed opposite-meaning traps"],
  ["difficulty", "Self-rated EOL 1–5 (harder → shorter h)"],
  ["night_study_rate", "Late-night encoding consolidates worse"],
  ["massed_practice_rate", "Same-day crams vs true spacing"],
  ["study_routine", "Steady study hour strengthens encoding"],
] as const;

const NOVELTY = [
  {
    title: "Honest MLE, not leaky regression",
    body: "A single correct/wrong isn’t a probability. Inverting fake P into h_obs and regressing (especially with Δt in features) lets the model rediscover the label. We keep Δt out of x and fit Bernoulli likelihood instead.",
  },
  {
    title: "Personalized HLR in a full study loop",
    body: "Not a notebook demo — ingest → flip cards → meaning/poker tests → retrain → queue, curve, schedule, and a head-to-head Insights board against SM-2 and FSRS.",
  },
  {
    title: "Behavioral features that actually train",
    body: "Read time, answer latency, EOL difficulty, trap fails, and study-habit rates (night / massed / routine) sit in the same half-life model — not just “again / hard / good / easy.”",
  },
  {
    title: "Transparency by design",
    body: "Every queue row can say why. Insights shows log-loss, calibration, and feature drivers. Bootstrap bands on the curve show when we’re unsure.",
  },
] as const;

const FACTS = [
  {
    k: "P = 2^(−Δt/h)",
    v: "Base-2 exponential forgetting — half-life h is when you’re ~50% likely to still know it.",
  },
  {
    k: "h = exp(w · x)",
    v: "Half-life from a linear model in log-space; always positive.",
  },
  {
    k: "Settles & Meeder",
    v: "HLR lineage (ACL 2016); adapted here for single binary reviews via MLE.",
  },
  {
    k: "≥ ~10 reviews",
    v: "Below that we lean on the cold-start prior; above that personalization pulls away.",
  },
  {
    k: "End-of-session retrain",
    v: "Weights refit when you finish a study block — queue and curve update immediately.",
  },
  {
    k: "Four-way bake-off",
    v: "Trained HLR vs prior vs SM-2 vs FSRS on held-out reviews (log-loss, Brier, ECE, accuracy).",
  },
  {
    k: "Multimodal ingest",
    v: "PDF, paste, audio (Whisper), image OCR, YouTube/article links → auto flashcards.",
  },
  {
    k: "Δt never a feature",
    v: "Lag only enters the likelihood. That’s the anti-leakage rule the whole fit depends on.",
  },
] as const;

export default async function ModelPage() {
  const user = await getCurrentUser();

  return (
    <main className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 top-0 h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(circle,rgba(142,180,232,0.12),transparent_68%)] blur-2xl" />
        <div className="absolute left-[-8%] top-[40%] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(154,171,188,0.08),transparent_70%)] blur-3xl" />
      </div>

      <section className="relative mx-auto max-w-5xl px-4 pb-8 pt-14 sm:pt-16">
        <p className="eyebrow text-aurora">Showcase · science</p>
        <h1 className="mt-3 max-w-3xl font-[family-name:var(--font-display)] text-4xl leading-[1.05] tracking-tight sm:text-5xl">
          The retention model —{" "}
          <span className="text-aurora">step by step</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
          Half-Life Regression fit to your reviews. Ranks what you&apos;re about
          to forget — with equations you can defend in a demo.
        </p>

        <nav
          aria-label="On this page"
          className="nav-strip mt-8 flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-between"
        >
          {(
            [
              ["#pipeline", "Pipeline"],
              ["#equations", "Equations"],
              ["#features", "Features"],
              ["#novelty", "Novelty"],
              ["#facts", "Facts"],
            ] as const
          ).map(([href, label]) => (
            <a key={href} href={href} className="nav-pill shrink-0 sm:flex-1">
              {label}
            </a>
          ))}
        </nav>
      </section>

      {/* Pipeline */}
      <section
        id="pipeline"
        className="relative mx-auto mt-14 max-w-5xl scroll-mt-20 px-4"
      >
        <p className="eyebrow text-aurora">Pipeline</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl">
          Six steps from a review to a ranked queue
        </h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((step) => (
            <li
              key={step.n}
              className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/70 p-5"
            >
              <p className="font-[family-name:var(--font-display)] text-3xl text-[var(--accent)]/45">
                {step.n}
              </p>
              <h3 className="mt-3 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Equations */}
      <section
        id="equations"
        className="relative mx-auto mt-20 max-w-5xl scroll-mt-20 px-4"
      >
        <p className="eyebrow text-aurora">Equations</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl">
          The math in one glance
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Forgetting curve
            </p>
            <p className="mt-4 font-[family-name:var(--font-display)] text-2xl text-[var(--ink)] sm:text-3xl">
              P = 2<sup className="text-[var(--accent)]">−Δt / h</sup>
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
              At Δt = h, P = ½ — that&apos;s why we call h the half-life. Larger
              h → slower fade → you can wait longer before reviewing.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Half-life from features
            </p>
            <p className="mt-4 font-[family-name:var(--font-display)] text-2xl text-[var(--ink)] sm:text-3xl">
              h = exp(w · x)
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
              w is fit per user by MLE; x never includes the current lag Δt. The
              lag only appears when we <em>evaluate</em> P — so the model can&apos;t
              cheat by reading the answer off the clock.
            </p>
          </div>
        </div>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
          Training insight: if you got a card right at a long lag, likelihood
          pushes h up; if you missed it soon, h goes down. A Gaussian prior
          centered on hand-tuned weights keeps tiny histories from going wild.
        </p>
      </section>

      {/* Features */}
      <section
        id="features"
        className="relative mx-auto mt-20 max-w-5xl scroll-mt-20 px-4"
      >
        <p className="eyebrow text-aurora">Feature vector</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl">
          What the model actually sees
        </h2>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Memory-trace signals only — encoding quality and past outcomes, not
          “how many days until you opened the app.”
        </p>
        <div className="panel mt-8 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3 font-normal">Feature</th>
                <th className="px-4 py-3 font-normal">What it captures</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map(([name, desc]) => (
                <tr
                  key={name}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="px-4 py-3 font-mono text-xs text-[var(--accent)]">
                    {name}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Novelty */}
      <section
        id="novelty"
        className="relative mx-auto mt-20 max-w-5xl scroll-mt-20 px-4"
      >
        <p className="eyebrow text-aurora">Novelty</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl">
          What&apos;s new about this project
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {NOVELTY.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/70 px-6 py-6"
            >
              <h3 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Facts */}
      <section
        id="facts"
        className="relative mx-auto mt-20 max-w-5xl scroll-mt-20 px-4 pb-8"
      >
        <p className="eyebrow text-aurora">Facts</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl">
          Important features &amp; talking points
        </h2>
        <ul className="mt-8 space-y-3">
          {FACTS.map((f) => (
            <li
              key={f.k}
              className="grid grid-cols-1 items-baseline gap-1 rounded-2xl border border-[var(--line)] px-5 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6"
            >
              <span className="font-[family-name:var(--font-display)] text-[var(--accent)]">
                {f.k}
              </span>
              <span className="text-sm leading-relaxed text-[var(--muted)]">
                {f.v}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="relative mx-auto max-w-5xl px-4 pb-20 pt-6">
        <div className="flex flex-col items-start justify-between gap-6 border-t border-[var(--line)] pt-10 sm:flex-row sm:items-center">
          <div>
            <p className="font-[family-name:var(--font-display)] text-2xl">
              See it ranked live
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Queue for fade risk · Insights for the bake-off · Curve for the
              forecast.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {user ? (
              <>
                <Link
                  href="/queue"
                  className="btn-primary px-5 py-2.5 text-sm font-semibold"
                >
                  Today&apos;s Queue
                </Link>
                <Link
                  href="/insights"
                  className="btn-ghost px-5 py-2.5 text-sm"
                >
                  Insights
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="btn-primary px-5 py-2.5 text-sm font-semibold"
                >
                  Sign in to demo
                </Link>
                <Link
                  href="/how-it-works"
                  className="btn-ghost px-5 py-2.5 text-sm"
                >
                  How it works
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
