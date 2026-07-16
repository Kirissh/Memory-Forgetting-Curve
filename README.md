# Recall Engine

Upload notes → auto-generate flashcards → study in an Anki-style UI → get a **Today's Queue** ranked by a **trained Half-Life Regression** retention model (not a fixed SM-2 formula).

Free-stack showcase MVP from [`recall-engine-architecture.md`](./recall-engine-architecture.md).

## Stack

| Piece | Choice |
|---|---|
| App | Next.js App Router (UI + API routes) |
| Data (local) | JSON store in `.data/db.json` — zero setup |
| Data (prod path) | Supabase SQL in `supabase/migrations/` |
| LLM | [LLM7.io](https://llm7.io) OpenAI-compatible free API |
| Embeddings | Local 384-d hash projection (`src/lib/embeddings.ts`) |
| Retention | Half-Life Regression fit by MLE in TypeScript (`src/lib/retention.ts`) |

## Quick start

```bash
cp .env.example .env.local
# optional: set LLM7_API_KEY from https://dash.llm7.io

npm install
npm run seed          # demo user + biology deck + review history
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**Demo login:** `demo@recall.local` / `demo1234`

Then: **Today's Queue** → Start Session → Space to flip → `1` incorrect / `2` correct. Ending a session retrains the model.

## Core loop

1. **Upload** PDF or paste text → chunk → embed → LLM7 flashcards  
2. **Study** with flip animation + keyboard shortcuts  
3. **Review log** updates per-concept streaks / misses  
4. **HLR retrain** (end of session): maximum-likelihood fit of `P = 2^(-Δt/h)`, `h = exp(w · x)` over review history — an exponential survival model, regularized toward the cold-start prior so a short history degrades gracefully  
5. **Queue** ranks by `p_recall = 2^(-Δt / h)`, plus a “why” explanation from top feature contributions  
6. **Curve** (`/curve`) inverts the same model per concept: `Δt = h · -log₂(p)` is the day it drops through your threshold  

## API

| Route | Purpose |
|---|---|
| `POST /api/auth` | signup / login |
| `GET/POST /api/materials` | list / upload |
| `GET/DELETE /api/materials/:id` | detail / delete |
| `POST /api/reviews` | log correct/incorrect |
| `PUT /api/reviews` | end session → retrain |
| `GET /api/queue/today` | ranked queue + explanations |
| `POST /api/model/retrain` | force HLR refit |

## Evaluation

After you have ≥10 reviews, end a session or `POST /api/model/retrain`. The response includes held-out log-loss vs the cold-start heuristic prior. The Queue UI surfaces the % improvement when available.

```bash
npm run eval          # held-out log-loss vs prior + learned weights
npm run verify:mle    # estimator check: recover known weights from synthetic data
```

Both numbers are mean negative log-likelihood per review; `ln 2 ≈ 0.693` is what you score by guessing 50% every time. A single-digit-percent gain over the prior is a real result on ~100 reviews. **Loss near zero means something is leaking, not that the model is good** — `eval` warns when it sees this. Two rules keep it honest: `days_since_last_review` is not a feature (Δt enters only through the likelihood — as a feature it lets the model invert its own target), and training features are replayed to their state *as of* each review rather than read off today's concept row.

Optional Python mirror of the trainer: `python ml/train_hlr.py` (needs `numpy`, `scikit-learn`).

## Env

```
LLM7_API_KEY=unused   # or your free dash.llm7.io token
```

Without a working LLM key, use `npm run seed` for a ready demo deck, or paste text may fail card generation until the key works.
