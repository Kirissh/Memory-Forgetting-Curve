import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";

export default async function HowItWorksPage() {
  const user = await getCurrentUser();

  return (
    <>
      <Nav email={user?.email} />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <p className="eyebrow text-aurora">Under the hood</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          How <span className="text-aurora">Recall</span> actually works
        </h1>
        <p className="mt-4 text-lg text-[var(--muted)]">
          Not another flashcard app that guesses. A half-life regression model
          watches how you learn and test — then predicts when each idea will
          fade, so today&apos;s queue is the stuff you&apos;re about to lose.
        </p>

        <section className="mt-14 space-y-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            The loop
          </h2>
          <ol className="space-y-4 text-[var(--muted)]">
            <li className="panel p-5">
              <p className="text-sm font-medium text-[var(--ink)]">
                1 · Library
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                You upload notes, PDFs, YouTube, or a URL. We chunk the text,
                embed it, and ask an LLM to cut flashcards — front (prompt) and
                back (meaning).
              </p>
            </li>
            <li className="panel p-5">
              <p className="text-sm font-medium text-[var(--ink)]">
                2 · Learn (flip)
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                Real flashcards: front first, flip to the back, then rate how
                hard it felt (1–5). We log how long you spent reading — careful
                encoding usually predicts stronger memory later.
              </p>
            </li>
            <li className="panel p-5">
              <p className="text-sm font-medium text-[var(--ink)]">
                3 · Test
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                Meaning check (summary vs opposite), free recall (type it), or
                Poker table (bet chips against Kirissh, Arnav, Harshith, and
                Sai). We log whether you were right and how fast you answered —
                slow retrieval is a strong signal that the trace is weak.
              </p>
            </li>
            <li className="panel p-5">
              <p className="text-sm font-medium text-[var(--ink)]">
                4 · Retrain → queue / curve / schedule
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                End of session: the model refits your half-lives. Tomorrow&apos;s
                queue ranks by fade risk; the curve shows when each topic drops
                below your threshold; the schedule spreads reviews under a daily
                cap.
              </p>
            </li>
          </ol>
        </section>

        <section className="mt-14 space-y-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            Why so many tests?
          </h2>
          <p className="text-[var(--muted)] leading-relaxed">
            A single “I got it” is almost useless. Memory models need{" "}
            <em className="text-[var(--ink)] not-italic">repeated outcomes</em>{" "}
            — correct or miss, at different gaps, with different difficulty and
            timing. Each attempt is a Bernoulli trial: did you still know it
            after Δt days?
          </p>
          <p className="text-[var(--muted)] leading-relaxed">
            With few attempts the app leans on a cold-start prior (generic
            student). After about 10+ graded reviews it personalizes. With
            dozens per topic it can tell which ideas are leeches (keep failing)
            versus which are sticky. That&apos;s why attempt counts show up on
            the queue — the more, the merrier for the model.
          </p>
          <div className="panel grid gap-3 p-5 sm:grid-cols-3">
            {[
              ["0–3", "Prior guesses", "Half-lives mostly default"],
              ["~10+", "Starts fitting you", "Weights leave the prior"],
              ["30+", "Sharp forget map", "Per-topic confidence rises"],
            ].map(([n, t, d]) => (
              <div key={n}>
                <p className="font-[family-name:var(--font-display)] text-2xl text-[var(--accent)]">
                  {n}
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">{t}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 space-y-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            What the model “knows” about you
          </h2>
          <p className="text-[var(--muted)] leading-relaxed">
            It does <strong className="font-medium text-[var(--ink)]">not</strong>{" "}
            read your mind or your notes for intent. It estimates a half-life{" "}
            <span className="text-[var(--ink)]">h</span> per concept from
            features built only from your history:
          </p>
          <ul className="space-y-2 text-sm text-[var(--muted)]">
            {[
              "Correct streaks & miss counts",
              "How many times you’ve reviewed it",
              "Spacing between reviews",
              "Time spent reading while learning",
              "Time taken to answer in testing",
              "How hard it felt (EOL 1–5)",
              "Trap / opposite-summary fail rate",
              "Study habits (late-night, cramming, routine)",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-[var(--accent)]">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-[var(--muted)] leading-relaxed">
            Then recall at lag Δt is{" "}
            <span className="text-[var(--ink)]">
              P = 2<sup>−Δt/h</sup>
            </span>
            . If Insights says “mainly time to answer in testing, 2 misses,”
            that&apos;s a real contribution from those features — not a vibe.
            Calibration charts on Insights show how honest those probabilities
            are.
          </p>
        </section>

        <section className="mt-14 space-y-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            Poker table
          </h2>
          <p className="text-[var(--muted)] leading-relaxed">
            Same memory check, dressed as a game. You and four rivals —{" "}
            <span className="text-[var(--ink)]">Kirissh, Arnav, Harshith, Sai</span>{" "}
            — see a prompt and four summary options. Stake chips, lock in, and
            they reveal their picks. Correct doubles your stake (even money);
            wrong loses it. Your grade still trains the model; the bots are for
            pressure and fun, not for grading you.
          </p>
        </section>

        <section className="mt-14 space-y-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            Curve by material
          </h2>
          <p className="text-[var(--muted)] leading-relaxed">
            On the Curve page, filter by a library deck to see only that
            material&apos;s concepts — useful when you&apos;re juggling multiple
            courses. Open any material and hit “View curve” to jump straight
            there.
          </p>
        </section>

        <div className="mt-14 flex flex-wrap gap-3">
          {user ? (
            <>
              <Link
                href="/queue"
                className="btn-primary px-5 py-2.5 text-sm font-semibold"
              >
                Today&apos;s Queue
              </Link>
              <Link href="/curve" className="btn-ghost px-5 py-2.5 text-sm">
                Curve
              </Link>
              <Link href="/insights" className="btn-ghost px-5 py-2.5 text-sm">
                Insights
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/signup"
                className="btn-primary px-5 py-2.5 text-sm font-semibold"
              >
                Start free
              </Link>
              <Link href="/login" className="btn-ghost px-5 py-2.5 text-sm">
                Sign in
              </Link>
            </>
          )}
        </div>
      </main>
    </>
  );
}
