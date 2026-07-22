import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";

const STEPS = [
  {
    n: "01",
    title: "Drop in your notes",
    body: "Upload a PDF, paste text, or share a link. Recall turns them into clear flashcards — question on the front, meaning on the back.",
  },
  {
    n: "02",
    title: "Learn, then flip",
    body: "Study like real cards: see the prompt, flip when ready, and rate how hard it felt. That quiet judgment matters more than you think.",
  },
  {
    n: "03",
    title: "Check what stuck",
    body: "A quick meaning check, type-it-from-memory, or a poker round with friends at the table. Right or wrong — both teach the system something.",
  },
  {
    n: "04",
    title: "See what fades next",
    body: "Your queue, curve, and schedule update around you. Tomorrow’s list isn’t random — it’s the ideas most likely to slip first.",
  },
] as const;

const SIGNALS = [
  {
    title: "How long you linger",
    body: "Careful reading usually sticks longer than a skim.",
  },
  {
    title: "How fast you answer",
    body: "Hesitation is a soft hint that the idea is already drifting.",
  },
  {
    title: "Hits and misses",
    body: "Streaks and slips shape which topics need you sooner.",
  },
  {
    title: "How hard it felt",
    body: "Your gut rating of difficulty is surprisingly predictive.",
  },
] as const;

export default async function HowItWorksPage() {
  const user = await getCurrentUser();

  return (
    <>
      <main className="relative overflow-hidden">
        {/* Atmosphere */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-0 h-[42rem] w-[42rem] rounded-full bg-[radial-gradient(circle,rgba(142,180,232,0.14),transparent_68%)] blur-2xl" />
          <div className="absolute right-[-10%] top-[28%] h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle,rgba(154,171,188,0.1),transparent_70%)] blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-64 w-[80%] -translate-x-1/2 bg-[linear-gradient(180deg,transparent,rgba(7,10,16,0.9))]" />
        </div>

        {/* Hero — one composition */}
        <section className="relative mx-auto max-w-5xl px-4 pb-8 pt-16 sm:pt-20">
          <p className="animate-rise eyebrow text-aurora">Recall</p>
          <h1
            className="animate-rise mt-4 max-w-3xl font-[family-name:var(--font-display)] text-5xl leading-[1.05] tracking-tight sm:text-6xl"
            style={{ animationDelay: "60ms" }}
          >
            Memory fades.{" "}
            <span className="text-aurora">We notice before you do.</span>
          </h1>
          <p
            className="animate-rise mt-6 max-w-xl text-lg leading-relaxed text-[var(--muted)]"
            style={{ animationDelay: "120ms" }}
          >
            Every time you study and check yourself, Recall quietly learns which
            ideas stick and which slip — then nudges you back right before they
            disappear.
          </p>
        </section>

        {/* Visual: fading curve metaphor */}
        <section
          className="animate-rise relative mx-auto mt-10 max-w-5xl px-4"
          style={{ animationDelay: "180ms" }}
          aria-hidden
        >
          <div className="how-canvas overflow-hidden rounded-[1.75rem] border border-[var(--line)] px-6 py-8 sm:px-10 sm:py-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  The idea
                </p>
                <p className="mt-2 font-[family-name:var(--font-display)] text-2xl sm:text-3xl">
                  Fresh today · fuzzy tomorrow
                </p>
              </div>
              <p className="max-w-xs text-sm text-[var(--muted)]">
                Practice pulls the curve back up. Wait too long and it drifts
                away.
              </p>
            </div>

            <svg
              viewBox="0 0 640 220"
              className="mt-8 h-auto w-full"
              role="img"
              aria-label="Illustration of memory strength fading over time, then rising after a review"
            >
              <defs>
                <linearGradient id="howFade" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#8eb4e8" stopOpacity="0.9" />
                  <stop offset="70%" stopColor="#8eb4e8" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#e87a84" stopOpacity="0.55" />
                </linearGradient>
                <linearGradient id="howFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8eb4e8" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#8eb4e8" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* grid whispers */}
              {[40, 90, 140, 190].map((y) => (
                <line
                  key={y}
                  x1="24"
                  x2="616"
                  y1={y}
                  y2={y}
                  stroke="rgba(232,238,246,0.06)"
                />
              ))}
              <path
                d="M40 48 C 120 52, 180 70, 240 110 C 300 150, 340 175, 400 188"
                fill="none"
                stroke="url(#howFade)"
                strokeWidth="3"
                strokeLinecap="round"
                className="how-curve"
              />
              <path
                d="M40 48 C 120 52, 180 70, 240 110 C 300 150, 340 175, 400 188 L 400 200 L 40 200 Z"
                fill="url(#howFill)"
              />
              {/* review spark */}
              <circle cx="400" cy="188" r="7" fill="#8eb4e8" className="how-pulse" />
              <path
                d="M400 188 C 460 120, 520 70, 600 52"
                fill="none"
                stroke="#7aaf96"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="6 8"
                className="how-curve-delay"
              />
              <text
                x="40"
                y="34"
                fill="#8b97a8"
                fontSize="11"
                letterSpacing="0.12em"
              >
                STRONG
              </text>
              <text
                x="40"
                y="212"
                fill="#8b97a8"
                fontSize="11"
                letterSpacing="0.12em"
              >
                TIME →
              </text>
              <text
                x="412"
                y="208"
                fill="#8eb4e8"
                fontSize="11"
                letterSpacing="0.08em"
              >
                you review
              </text>
              <text
                x="520"
                y="44"
                fill="#7aaf96"
                fontSize="11"
                letterSpacing="0.08em"
              >
                memory returns
              </text>
            </svg>
          </div>
        </section>

        {/* Journey */}
        <section className="relative mx-auto mt-24 max-w-5xl px-4">
          <p className="eyebrow text-aurora">Your session</p>
          <h2 className="mt-3 max-w-xl font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            Four quiet steps. One clearer mind.
          </h2>

          <div className="mt-12 grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                className="how-step relative border-t border-[var(--line)] px-1 py-8 sm:border-t-0 sm:border-l sm:px-5 sm:first:border-l-0"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <p className="font-[family-name:var(--font-display)] text-4xl text-[var(--accent)]/40">
                  {step.n}
                </p>
                <h3 className="mt-4 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Why many checks */}
        <section className="relative mx-auto mt-24 max-w-5xl px-4">
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="eyebrow text-aurora">Why so many checks?</p>
              <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
                One lucky guess isn&apos;t a memory.
              </h2>
              <p className="mt-5 max-w-lg text-[var(--muted)] leading-relaxed">
                Getting something right once can be chance. Getting it right
                again tomorrow — after sleep, after distraction — is the real
                signal. Each check paints a clearer picture of what you still
                hold, and what&apos;s quietly leaving.
              </p>
              <p className="mt-4 max-w-lg text-[var(--muted)] leading-relaxed">
                That&apos;s why attempt counts show up in your queue. More
                practice doesn&apos;t just help <em>you</em> — it helps Recall
                know you better.
              </p>
            </div>

            <div className="how-canvas space-y-3 rounded-[1.5rem] border border-[var(--line)] p-6">
              {[
                {
                  label: "Just starting",
                  hint: "We use a gentle default until we’ve seen a few checks.",
                  width: "28%",
                },
                {
                  label: "Getting to know you",
                  hint: "Patterns start to show — what’s sticky vs slippery.",
                  width: "58%",
                },
                {
                  label: "Clear picture",
                  hint: "Your queue and curve feel personal, not generic.",
                  width: "92%",
                },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--ink)]">
                      {row.label}
                    </p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                    <div
                      className="how-bar h-full rounded-full bg-[image:var(--grad-aurora)]"
                      style={{ width: row.width }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">{row.hint}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What we notice — plain language, no sauce */}
        <section className="relative mx-auto mt-24 max-w-5xl px-4">
          <p className="eyebrow text-aurora">What we notice</p>
          <h2 className="mt-3 max-w-2xl font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            Not mind-reading. Just studying how you study.
          </h2>
          <p className="mt-4 max-w-xl text-[var(--muted)] leading-relaxed">
            Recall never opens your private thoughts. It only watches the
            footprints you leave while learning — then uses those to guess when
            each idea might fade.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {SIGNALS.map((s, i) => (
              <div
                key={s.title}
                className="group relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]/60 px-6 py-6 transition hover:border-[rgba(142,180,232,0.35)]"
              >
                <div
                  aria-hidden
                  className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(142,180,232,0.12),transparent_70%)] opacity-0 transition group-hover:opacity-100"
                />
                <p className="relative font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                  <span className="mr-2 text-[var(--accent)]/50">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.title}
                </p>
                <p className="relative mt-2 text-sm leading-relaxed text-[var(--muted)]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Poker aside */}
        <section className="relative mx-auto mt-24 max-w-5xl px-4 pb-8">
          <div className="how-felt relative overflow-hidden rounded-[1.75rem] border border-[var(--line)] px-6 py-10 sm:px-10">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(42,90,66,0.35),transparent_55%)]"
            />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="eyebrow text-aurora">Optional mode</p>
                <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl">
                  Poker table
                </h2>
                <p className="mt-4 max-w-lg text-[var(--muted)] leading-relaxed">
                  Same memory check, more pressure. Bet colored chips on the
                  right summary while rivals play their hands. Run out of chips
                  and the table closes — fun for you, still useful training for
                  Recall.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {[10, 25, 50, 100].map((n) => (
                  <span
                    key={n}
                    className={`poker-chip poker-chip--${n} pointer-events-none`}
                    aria-hidden
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative mx-auto max-w-5xl px-4 pb-20 pt-10">
          <div className="flex flex-col items-start justify-between gap-6 border-t border-[var(--line)] pt-10 sm:flex-row sm:items-center">
            <div>
              <p className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl">
                Ready when you are.
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Start a session — the picture gets clearer every round.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {user ? (
                <>
                  <Link
                    href="/queue"
                    className="btn-primary px-6 py-3 text-sm font-semibold"
                  >
                    Today&apos;s Queue
                  </Link>
                  <Link
                    href="/curve"
                    className="btn-ghost px-6 py-3 text-sm"
                  >
                    See your curve
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="btn-primary px-6 py-3 text-sm font-semibold"
                  >
                    Start free
                  </Link>
                  <Link
                    href="/login"
                    className="btn-ghost px-6 py-3 text-sm"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
