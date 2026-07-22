"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/library", label: "Library" },
  { href: "/queue", label: "Today's Queue" },
  { href: "/study?mode=poker", label: "Poker" },
  { href: "/curve", label: "Curve" },
  { href: "/schedule", label: "Schedule" },
  { href: "/insights", label: "Insights" },
  { href: "/how-it-works", label: "How it works" },
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

export function Nav({ email }: { email?: string | null }) {
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
            <Link href="/login" className="btn-primary px-4 py-1.5 text-sm">
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
