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
| Retention | Closed-form ridge HLR in TypeScript (`src/lib/retention.ts`) |

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
4. **HLR retrain** (end of session): `w = (XᵀX + λI)⁻¹ Xᵀy` over review history  
5. **Queue** ranks by `p_recall = 2^(-Δt / h)` with `h = exp(w · x)`, plus a “why” explanation from top feature contributions  

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

Optional Python mirror of the trainer: `python ml/train_hlr.py` (needs `numpy`, `scikit-learn`).

## Env

```
LLM7_API_KEY=unused   # or your free dash.llm7.io token
```

Without a working LLM key, use `npm run seed` for a ready demo deck, or paste text may fail card generation until the key works.
