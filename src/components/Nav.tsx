"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function Nav({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const hideOnStudy = pathname?.startsWith("/study");

  if (hideOnStudy) return null;

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
            <Link
              href="/library"
              className={`relative transition-colors ${pathname === "/library" ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              Library
              {pathname === "/library" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
                />
              )}
            </Link>
            <Link
              href="/queue"
              className={`relative transition-colors ${pathname === "/queue" ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              Today&apos;s Queue
              {pathname === "/queue" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
                />
              )}
            </Link>
            <Link
              href="/curve"
              className={`relative transition-colors ${pathname === "/curve" ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              Curve
              {pathname === "/curve" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
                />
              )}
            </Link>
            <Link
              href="/schedule"
              className={`relative transition-colors ${pathname === "/schedule" ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              Schedule
              {pathname === "/schedule" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
                />
              )}
            </Link>
            <Link
              href="/insights"
              className={`relative transition-colors ${pathname === "/insights" ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              Insights
              {pathname === "/insights" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
                />
              )}
            </Link>
            <Link
              href="/how-it-works"
              className={`relative transition-colors ${pathname === "/how-it-works" ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              How it works
              {pathname === "/how-it-works" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
                />
              )}
            </Link>
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
              href="/login"
              className="btn-primary px-4 py-1.5 text-sm"
            >
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
