"use client";

import { FlashcardView } from "@/components/FlashcardView";
import type { QueueItem } from "@/components/QueueList";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function StudySession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTestMode = searchParams.get("mode") === "poker" ? "poker" : "probe";
  const [deck, setDeck] = useState<QueueItem[] | null>(null);

  useEffect(() => {
    fetch("/api/queue/today?limit=30")
      .then(async (r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) setDeck(data.items || []);
      });
  }, [router]);

  if (!deck) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        Loading session…
      </div>
    );
  }

  return (
    <FlashcardView
      deck={deck}
      initialTestMode={initialTestMode}
      onExit={() => router.push("/queue")}
    />
  );
}

export default function StudyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
          Loading session…
        </div>
      }
    >
      <StudySession />
    </Suspense>
  );
}
