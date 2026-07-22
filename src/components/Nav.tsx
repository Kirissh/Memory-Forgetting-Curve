"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/library", label: "Library" },
  { href: "/queue", label: "Queue" },
  { href: "/study?mode=poker", label: "Poker", match: "/study" },
  { href: "/shop", label: "Shop" },
  { href: "/leaderboard", label: "Board" },
  { href: "/curve", label: "Curve" },
  { href: "/schedule", label: "Schedule" },
  { href: "/insights", label: "Insights" },
  { href: "/how-it-works", label: "Guide" },
  { href: "/model", label: "Model" },
] as const;

const HIDE_ON = ["/study", "/login", "/signup"];

function isActive(pathname: string, href: string, match?: string) {
  if (match) return pathname === match || pathname.startsWith(match + "/");
  return pathname === href;
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
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(5,8,15,0.78)] backdrop-blur-md">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[image:var(--grad-aurora)] opacity-30"
      />

      {/* Brand row */}
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-3 px-4">
        <Link
          href={email ? "/library" : "/"}
          className="shrink-0 font-[family-name:var(--font-display)] text-xl tracking-tight text-aurora"
        >
          Recall
        </Link>

        {email ? (
          <div className="flex items-center gap-2 sm:gap-3">
            {typeof brains === "number" && (
              <Link
                href="/queue#brains"
                title={`${streak ?? 0}-day streak · ${brains} Recall Brains`}
                className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-panel)]/60 px-2.5 py-1 text-[11px] tabular-nums transition-colors hover:border-[var(--accent)]"
              >
                <span className={streak ? "" : "opacity-40 grayscale"}>
                  🔥{" "}
                  <span className="text-[var(--ink)]">{streak ?? 0}</span>
                </span>
                <span className="text-[var(--line)]">·</span>
                <span>
                  🧠 <span className="text-[var(--accent)]">{brains}</span>
                </span>
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="shrink-0 whitespace-nowrap text-xs text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              Log out
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/how-it-works"
              className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              Guide
            </Link>
            <Link
              href="/model"
              className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              Model
            </Link>
            <Link href="/login" className="btn-primary px-4 py-1.5 text-sm">
              Sign in
            </Link>
          </div>
        )}
      </div>

      {/* Section strip — only when signed in */}
      {email ? (
        <div className="border-t border-[var(--line)]/60">
          <div className="mx-auto max-w-5xl px-3 py-2 sm:px-4">
            <nav
              aria-label="Main"
              className="nav-strip no-scrollbar flex gap-1 overflow-x-auto pb-0.5"
            >
              {LINKS.map((l) => {
                const active = isActive(
                  pathname || "",
                  l.href,
                  "match" in l ? l.match : undefined
                );
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={`nav-pill shrink-0 ${active ? "is-active" : ""}`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}
