# Recall Engine

Upload notes → auto-generate flashcards → study in an Anki-style UI → get a **Today's Queue** ranked by a **trained Half-Life Regression** retention model — then see *when* to review each card, *which model actually predicts best*, and *what's quietly rotting*.

Free-stack showcase MVP from [`recall-engine-architecture.md`](./recall-engine-architecture.md).

## Stack

| Piece | Choice |
|---|---|
| App | Next.js App Router (UI + API routes) |
| Data (local) | JSON store in `.data/db.json` — zero setup |
| Data (prod path) | Supabase SQL in `supabase/migrations/` |
| LLM | [LLM7.io](https://llm7.io) OpenAI-compatible free API |
| Embeddings | Local 384-d — MiniLM (semantic) or hash projection (`src/lib/embeddings.ts`) |
| Retention | Half-Life Regression fit by MLE in TypeScript (`src/lib/retention.ts`) |

## Quick start

```bash
cp .env.example .env.local
# optional: set LLM7_API_KEY from https://dash.llm7.io
# EMBEDDING_BACKEND=hash uses the pure-JS embedder (no native onnxruntime needed)

npm install
npm run seed          # demo user + 15-concept biology deck + review history + trained model
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). **Demo login:** the "Sign in as demo user" button (or `demo@recall.local` / `demo1234`).

Then: **Today's Queue** → Start → learn → rate difficulty → test. Ending a session retrains the model.

## Core loop

1. **Upload** PDF or paste text → chunk → embed → LLM7 flashcards (+ a cloze deletion per card)
2. **Study** — learn phase (dwell time + 1–5 ease-of-learning), then a **meaning check** or typed **free recall**
3. **Review log** updates per-concept streaks / misses / FSRS state
4. **HLR retrain** (end of session): maximum-likelihood fit of `P = 2^(-Δt/h)`, `h = exp(w · x)` over review history — an exponential survival model, regularized toward the cold-start prior so a short history degrades gracefully
5. **Queue** ranks by fade-risk at your model horizon, interleaved across sources, plus a "why" from top feature contributions

## Pages

| Route | What it shows |
|---|---|
| `/queue` | Today's ranked queue (leech badges, weakest-first) |
| `/curve` | Every concept on its own forgetting curve, with a **bootstrap uncertainty band** and the day it drops through your threshold |
| `/schedule` | Optimal next-review date per card (`Δt = h · −log₂(target)`), **workload-spread** under a daily cap, with a downloadable **.ics** feed |
| `/insights` | **Model face-off** (HLR vs cold-start prior vs SM-2 vs FSRS), a **reliability diagram**, which features drive your half-lives, accuracy over time, and **leeches** |

## The models

- **HLR (trained)** — the app's own Half-Life Regression, MLE-fit per user, regularized toward the prior.
- **Prior (cold-start)** — the same feature model, untrained. The gap to HLR is what personalization buys.
- **SM-2** — the classic SuperMemo scheduler as a baseline; its interval is inverted into a half-life so it emits comparable probabilities (`src/lib/sm2.ts`).
- **FSRS** — an FSRS-inspired **per-card** model (evolving stability + difficulty; the spacing effect is explicit) with a light in-app fit (`src/lib/fsrs.ts`).

All four are scored **head-to-head on the same held-out reviews** — first review per card dropped, FSRS fit only on the pre-split slice — with log-loss, Brier, ECE, calibration bins, and accuracy (`src/lib/calibration.ts`). Accuracy is not calibration: a model can be more accurate yet worse-calibrated, and the dashboard shows both.

## API

| Route | Purpose |
|---|---|
| `POST /api/auth` | signup / login |
| `GET/POST /api/materials` | list / upload |
| `POST /api/reviews` | log a review (evolves FSRS state online) |
| `PUT /api/reviews` | end session → retrain |
| `POST /api/grade` | free-recall grading by embedding similarity |
| `GET /api/queue/today` | ranked queue + explanations |
| `GET /api/curve` | forgetting-curve forecast + uncertainty band |
| `GET /api/schedule` | workload-aware review schedule + .ics |
| `GET /api/insights` | model comparison, calibration, drivers, leeches |
| `POST /api/model/retrain` | force HLR refit |

## Evaluation

After ≥10 reviews, ending a session retrains and populates the held-out comparison, surfaced on `/insights`.

```bash
npm run eval          # held-out comparison (HLR / prior / SM-2 / FSRS) + reliability + weights
npm run verify:mle    # estimator check: recover known weights from synthetic data, leakage probe
npm run fit-prior     # fit a data-driven cold-start prior on a synthetic learner population
```

`fit-prior` writes `ml/artifacts/prior_weights.json` and reports whether the fitted prior beats the hand-tuned one on held-out learners. Swap its synthetic population for real logs (e.g. the Duolingo HLR dataset) to productionize.

## Why no leakage

A single binary review is a Bernoulli *outcome*, not an observed probability. Regressing a half-life reverse-engineered from that outcome (`h_obs = Δt / −log₂(p)`) makes the target `log(Δt) + const`, which any model carrying Δt can invert — so the fit is a maximum-likelihood one where Δt enters *only* through the likelihood, never as a feature. Feature construction replays history forward, so each row sees only reviews before it. `npm run verify:mle` proves the estimator can't beat the base rate on shuffled labels.

## Env

```
LLM7_API_KEY=unused        # or your free dash.llm7.io token
EMBEDDING_BACKEND=hash     # "hash" (pure-JS) or "minilm" (semantic, needs native onnxruntime)
```

Without a working LLM key, use `npm run seed` for a ready demo deck.
.
.
.
