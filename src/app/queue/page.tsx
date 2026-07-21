"use client";

import { Nav } from "@/components/Nav";
import { FlashcardView } from "@/components/FlashcardView";
import { QueueList, useQueue } from "@/components/QueueList";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function QueuePage() {
  const { items, weakTopics, horizonDays, model, loading } = useQueue();
  const [studying, setStudying] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => {
        if (!r.ok) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) setEmail(data.user.email);
      });
  }, [router]);

  if (studying) {
    return (
      <FlashcardView
        deck={items}
        onExit={() => {
          setStudying(false);
          window.location.reload();
        }}
      />
    );
  }

  const improvement =
    model &&
    typeof model.heldOutLogLoss === "number" &&
    typeof model.baselineLogLoss === "number"
      ? (
          ((model.baselineLogLoss as number) -
            (model.heldOutLogLoss as number)) /
          (model.baselineLogLoss as number)
        ) * 100
      : null;

  return (
    <>
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="eyebrow text-aurora">
          Retention queue
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          Today&apos;s <span className="text-aurora">focus</span>
        </h1>
        <p className="mt-3 max-w-xl text-[var(--muted)]">
          What you&apos;re closest to losing, worst first. Each score is a
          trained half-life model&apos;s estimate of your recall — not a fixed
          schedule.
        </p>
        <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
          Learn → rate how hard it felt → meaning test. Ending a session
          retrains the model on what it just saw.
        </p>

        {model && (
          <p className="mt-4 text-xs text-[var(--muted)]">
            {model.usingPrior
              ? "Cold-start prior weights (need ≥10 tests to personalize)."
              : `Personalized on ${model.trainedOnReviewCount} tests.`}
            {improvement != null && Number.isFinite(improvement) && (
              <> Held-out log-loss {improvement.toFixed(1)}% better than prior.</>
            )}
          </p>
        )}

        <div className="mt-8">
          {loading ? (
            <p className="text-[var(--muted)]">Loading queue…</p>
          ) : (
            <QueueList
              items={items}
              weakTopics={weakTopics}
              horizonDays={horizonDays}
              onStart={() => setStudying(true)}
            />
          )}
        </div>
      </main>
    </>
  );
}
