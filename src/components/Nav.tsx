"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/library", label: "Library" },
  { href: "/queue", label: "Today's Queue" },
  { href: "/study?mode=poker", label: "Poker" },
  { href: "/shop", label: "Shop" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/curve", label: "Curve" },
  { href: "/schedule", label: "Schedule" },
  { href: "/insights", label: "Insights" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/model", label: "The model" },
];

// Routes that render their own full-bleed experience (or the auth screens).
const HIDE_ON = ["/study", "/login", "/signup"];

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`relative transition-colors ${
        active
          ? "text-[var(--ink)]"
          : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
        />
      )}
    </Link>
  );
}

export function Nav({
  email,
  streak,
  brains,
}: {
  email?: string | null;
  streak?: number;
  brains?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

  if (HIDE_ON.some((p) => pathname?.startsWith(p))) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(5,8,15,0.7)] backdrop-blur-md">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[image:var(--grad-aurora)] opacity-30"
      />
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href={email ? "/library" : "/"}
          className="font-[family-name:var(--font-display)] text-xl tracking-tight text-aurora"
        >
          Recall
        </Link>
        {email ? (
          <nav className="flex items-center gap-5 text-sm text-[var(--muted)]">
            {LINKS.map((l) => (
              <NavLink
                key={l.href}
                href={l.href}
                label={l.label}
                active={pathname === l.href}
              />
            ))}
            {typeof brains === "number" && (
              <Link
                href="/queue#brains"
                title={`${streak ?? 0}-day streak · ${brains} Recall Brains`}
                className="flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1 text-xs tabular-nums transition-colors hover:border-[var(--accent)]"
              >
                <span className={streak ? "" : "opacity-40 grayscale"}>
                  🔥<span className="ml-1 text-[var(--ink)]">{streak ?? 0}</span>
                </span>
                <span className="text-[var(--line)]">·</span>
                <span>
                  🧠<span className="ml-1 text-[var(--accent)]">{brains}</span>
                </span>
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              Log out
            </button>
          </nav>
        ) : (
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/how-it-works"
              className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              How it works
            </Link>
            <Link
              href="/model"
              className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              The model
            </Link>
            <Link href="/login" className="btn-primary px-4 py-1.5 text-sm">
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
