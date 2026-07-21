"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ demoEnabled }: { demoEnabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function authenticate(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Login failed");
      return;
    }
    router.push("/library");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await authenticate({ action: "login", email, password });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="panel animate-rise p-8">
        <Link href="/" className="font-[family-name:var(--font-display)] text-2xl text-aurora">
          Recall
        </Link>
        <h1 className="mt-8 font-[family-name:var(--font-display)] text-3xl">Sign <span className="text-aurora">in</span></h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field px-3 py-2.5"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field px-3 py-2.5"
        />
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {demoEnabled && (
        <div className="mt-6">
          <div className="rule-aurora" aria-hidden />
          <button
            type="button"
            onClick={() => authenticate({ action: "demo" })}
            disabled={busy}
            className="mt-6 w-full btn-ghost py-2.5 text-sm font-medium disabled:opacity-50"
          >
            Sign in as demo user
          </button>
          <p className="mt-2 text-center text-xs text-[var(--muted)]">
            Dev only — skips the password for DEMO_USER_EMAIL.
          </p>
        </div>
      )}

      <p className="mt-4 text-sm text-[var(--muted)]">
        No account?{" "}
        <Link href="/signup" className="text-[var(--accent)]">
          Sign up
        </Link>
      </p>
      </div>
    </main>
  );
}
