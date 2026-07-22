# Recall — 4‑minute demo script

**Prep (30 sec before you talk)**  
- App open: http://localhost:3000  
- Logged in as demo: `demo@recall.local` / `demo1234` (or “Sign in as demo user”)  
- Have **Today’s Queue** ready; biology deck already seeded  

**Timing map (~3:45)**  

| Time | Where | What you click |
|------|--------|----------------|
| 0:00–0:25 | Hook + Library | Show library, ×N learn badges, “Add material” tabs |
| 0:25–1:20 | Queue → Study | Start learn → flip → rate → pick **Meaning check** or **Poker** (1–2 cards) |
| 1:20–2:00 | Curve + Schedule | Filter by material; show “when you’ll forget” |
| 2:00–2:40 | Insights | Model face-off + “why” drivers |
| 2:40–3:10 | Brains / Shop / Leaderboard | Quick flex — currency, frames, efficiency |
| 3:10–3:45 | **The model** tab | Open `/model` — pipeline + novelty + facts (don’t read every line) |

---

## Spoken script (~3:45)

### Opening (0:00)

“This is **Recall** — upload notes, get flashcards, and a model that ranks what you’re *about to forget*, not what you already know.”

### Library (0:15)

“**Library** is where materials live — PDF, paste text, audio, image OCR, YouTube/link. Each topic shows an **×N** badge: how many times you’ve learned it. More attempts = a sharper forget map.”

### Queue + study loop (0:30)

“**Today’s Queue** ranks topics by *fade risk* — weakest first, with a one-line ‘why’ from the model.

I hit **Start**. Learn phase is real flashcards: **front only, flip to back**, rate how hard it felt 1–5. We log *how long you read* and that difficulty.

Then test — meaning check, free recall, or **Poker**. Poker is the same memory check with chips and rivals; bust and the table closes. Your grade still trains the model.”

*(Do 1 flip + rate, then 1 test hand. Don’t finish a full deck.)*

### Curve + schedule (1:20)

“**Curve** puts every concept on its forgetting curve — solid = time already passed, dashed = forecast. Filter by **one library deck**. Where it crosses 50% is roughly when that idea slips.

**Schedule** turns half-lives into *when to review next*, spread so you don’t get crushed in one day.”

### Insights (2:00)

“**Insights** is the honesty check. We pit our trained model against a cold-start prior, classic SM-2, and FSRS on held-out reviews — log-loss, accuracy, calibration. You also see which signals drive half-lives: misses, answer speed, study habits, and so on. **Leeches** are cards that keep dying.”

### Brains / Shop / Leaderboard (2:40)

“On top we added **Brains** — earn from studying, spend in the **Shop** on avatar frames. **Leaderboard** ranks study time and efficiency. Gamification sits *on* the retention loop; it doesn’t replace it.”

### The model tab (3:10)

*(Click **The model** in the nav — last tab.)*

“Here’s the science page. Six steps: log study events → build features → predict half-life → sample P = 2^(−Δt/h) → fit by maximum likelihood → retrain and rank. Novelty is honest MLE without leaking Δt into features, plus a full product loop and a bake-off against SM-2 and FSRS. Facts call out multimodal ingest and end-of-session retrain.”

### Close (3:40)

“So: multimodal ingest → learn/test loop → personalized forgetting forecast → transparent model bake-off. Deep dive lives on **The model** tab. Happy to go deeper on any piece.”

---

## Cheat sheet — what each main thing *means*

| Surface | One-liner for judges |
|---------|----------------------|
| **Library** | Your decks; ingest multimodal → auto cards |
| **Today’s Queue** | Ranked by predicted forgetting *at your horizon* |
| **Study** | Learn (flip + EOL) → test (probe / recall / poker) → retrain |
| **Poker** | Gamified MCQ test; chips + rivals; still logs reviews |
| **Curve** | Per-concept forecast of when recall drops below threshold |
| **Schedule** | Next review dates from half-lives + daily workload cap |
| **Insights** | HLR vs prior vs SM-2 vs FSRS + drivers + leeches |
| **Shop / Brains** | Earn currency from study; cosmetics |
| **Leaderboard** | Study time / efficiency social layer |
| **How it works** | User-facing story (no secret sauce dump) |
| **The model** | Step-by-step HLR, equations, novelty, facts — demo science tab |

---

## ML model — detailed deep dive (for Q&A / judges)

Use this when someone asks *how the model actually works*. The 4‑minute talk stays short; this is the full story.

### 1. What problem it solves

Spaced-repetition apps often use fixed rules (SM-2 intervals) or opaque heuristics. Recall asks a sharper question:

> For *this* learner and *this* concept, given everything we’ve observed about how they studied it, what’s the probability they still know it after Δt days?

That probability drives the queue (rank by fade risk), the curve (when P drops below a threshold), and the schedule (solve for the Δt that hits a target P).

### 2. The core equations (Half-Life Regression)

Inspired by **Settles & Meeder (ACL 2016)** Half-Life Regression, adapted for *single binary reviews* (not aggregated empirical rates).

**Recall curve (exponential forgetting in base‑2):**

\[
P(\text{recall} \mid \Delta t, h) = 2^{-\Delta t / h}
\]

- \(h\) = **half-life in days** — at \(\Delta t = h\), \(P = 0.5\).
- Longer \(h\) → memory decays slower → safer to wait.

**How half-life is produced from features:**

\[
h = \exp(w \cdot x) = \exp(z), \quad z = w \cdot x
\]

- \(x\) = feature vector describing the *memory trace* (not the clock).
- \(w\) = weight vector **fit per user** from their review history.
- \(\exp\) keeps \(h > 0\).

Equivalently, with \(\lambda = \ln 2 \cdot \Delta t \cdot e^{-z}\):

\[
P = e^{-\lambda}
\]

(same exponential survival model, just rewritten for gradients).

### 3. What goes into the feature vector \(x\)

Features describe **how well the memory was encoded / how it’s been behaving**, never “how many days since last open” as an input feature.

| Feature | Intuition | Typical prior sign |
|---------|-----------|-------------------|
| `bias` | Baseline half-life (~3 days cold start) | \(\log 3\) |
| `correct_streak` | Consecutive hits → stronger trace | + |
| `incorrect_count` | Cumulative misses → weaker | − |
| `log_total_reviews` | More practice → more data + usually stronger | + |
| `avg_days_between_reviews` | Historical spacing of *past* reviews | mild + |
| `concept_embedding_similarity` | Related concepts you already know | + |
| `log_read_time` | Longer careful reading while learning | + |
| `log_response_time` | Slow answers at test → weaker retrieval | − |
| `trap_fail_rate` | Failed “opposite meaning” traps | − |
| `difficulty` | Self-rated ease-of-learning 1–5 (harder → shorter \(h\)) | − |
| `night_study_rate` | Fraction of reviews late night (22:00–06:00) | − |
| `massed_practice_rate` | Same-day crams vs spaced repeats | − |
| `study_routine` | Consistency of study hour-of-day (0–1) | + |

**Critical design rule:** every rate/habit feature is computed from **prior reviews only** (forward replay of history). The lag \(\Delta t\) of the *current* review is **not** a feature.

### 4. What a training row looks like

Each past review becomes one labeled example:

| Piece | Meaning |
|-------|---------|
| \(x\) | Features as-of *before* this review |
| \(\Delta t\) | Days since previous review of this concept |
| \(y \in \{0,1\}\) | Correct / incorrect on this check |

A single review is a **Bernoulli trial**, not an observed probability. You cannot honestly invert \(y=1\) into “\(P=1\)” and regress a half-life — that causes **label leakage** (see below).

### 5. How we train: maximum likelihood (not fake regression)

**Objective:** maximize log-likelihood of the observed correct/wrong outcomes under \(P = 2^{-\Delta t/h}\), with \(h=\exp(w\cdot x)\).

Per-row idea:

- If you got it **right** at lag \(\Delta t\), push \(h\) up (memory stronger than expected).
- If you got it **wrong**, push \(h\) down.

Gradient on \(z = w\cdot x\) (intuition):

\[
\frac{\partial \mathrm{LL}}{\partial z} \propto \lambda \cdot \Big[y - (1-y)\frac{P}{1-P}\Big]
\]

Implemented with **Adam**, features **standardized** for conditioning, ~600 iterations.

**Regularization:** Gaussian pull toward a hand-tuned **cold-start prior** \(w_0\) (L2 strength ~30), not toward zero.

- Few reviews → weights stay near the prior → sensible ~3‑day half-lives.
- Lots of reviews → likelihood dominates → personalized \(w\).

Retrain triggers at **end of session** (`PUT /api/reviews` with retrain), once there’s enough history (≥ ~10 reviews to leave pure-prior scoring).

### 6. Why we refuse the “leaky” shortcut

Bad approach people try:

1. Pretend \(P_{\text{obs}} = 0.9\) if correct, \(0.1\) if wrong.
2. Invert \(h_{\text{obs}} = \Delta t / -\log_2(P_{\text{obs}})\).
3. Regress \(\log h\) on features **including** \(\Delta t\).

That makes the target basically \(\log(\Delta t) + \text{const}\). Any model that sees \(\Delta t\) can “fit” perfectly without learning memory — **leakage**.

Settles & Meeder avoid this by aggregating *many* trials per lag into a real empirical \(p\). We have one binary outcome per row, so we use **MLE on Bernoulli likelihood** and keep \(\Delta t\) **out of** \(x\).

### 7. How predictions are used in the product

**Score a concept now**

1. Build \(x\) from current aggregates (streaks, avg times, habits, …).
2. \(h = \exp(w\cdot x)\).
3. \(\Delta t_{\text{now}}\) = days since last review/learn/create (memory anchor).
4. \(P_{\text{now}} = 2^{-\Delta t_{\text{now}} / h}\).

**Today’s Queue**

- Compare cards at a **shared horizon** (personal median gap or median half-life), not raw \(P_{\text{now}}\) right after studying (everything looks 100%).
- Rank by **fade risk** \(\approx 1 - P_{\text{projected}}\).
- **Why** line = top feature contributions \(w_i x_i\) in plain English.

**Curve**

- Plot \(P(\Delta t)\) forward; solve age when \(P =\) threshold (e.g. 50%).
- Optional bootstrap band on weights → uncertainty on recall.

**Schedule**

- Invert: \(\Delta t^\* = h \cdot (-\log_2 P_{\text{target}})\), then spread under a daily cap.

### 8. Evaluation & model face-off (Insights)

On held-out reviews (first review per card dropped; fair split):

| Competitor | Role |
|------------|------|
| **HLR (trained)** | Our personalized \(w\) |
| **Prior (cold-start)** | Same features, untrained \(w_0\) — shows what personalization buys |
| **SM-2** | Classic scheduler; interval mapped to a comparable half-life |
| **FSRS** | Per-card stability/difficulty state, light in-app fit |

Metrics: **log-loss**, **Brier**, **ECE** (calibration), **accuracy**. Accuracy ≠ calibration — Insights shows both. Reliability diagram = predicted \(P\) vs empirical hit rate.

### 9. Sibling systems (not the HLR core, but related)

- **Embeddings (MiniLM / hash):** chunk similarity, free-recall grading by cosine similarity — separate from half-life fit.
- **FSRS state on concepts:** evolves online on each review for schedule/insights baselines.
- **Leech detector:** heuristic on misses + short half-life + trap fails — flags chronic failures.

### 10. One-paragraph “elevator tech” if you only get 20 seconds

“We model each concept’s memory as an exponential survival curve \(P=2^{-\Delta t/h}\). Half-life \(h\) is \(\exp(w\cdot x)\) from study-behavior features. We fit \(w\) by maximum likelihood on correct/incorrect reviews, regularized to a cold-start prior, without putting lag into the features so we don’t leak the label. The queue ranks by projected fade risk; Insights compares us to SM-2 and FSRS on held-out data.”

### 11. Model in 4 sentences (ultra-short backup)

1. **Half-life *h*** = how long until you’re ~50% likely to still know it.  
2. **h = exp(w · x)** — *x* is features from *how you studied*, *w* is fit per user.  
3. **P(recall after Δt) = 2^(−Δt/h)** — exponential forgetting, Settles & Meeder–style HLR.  
4. Fit by **MLE** on Bernoulli outcomes (got it / missed it), prior-regularized; queue ranks **1 − P** at a shared horizon.

---

## Demo don’ts (keeps you under 4 min)

- Don’t generate a new deck live (LLM wait).  
- Don’t finish a full poker session.  
- Don’t open How it works unless asked — use **The model** tab for science.  
- Don’t reseed mid-demo (wipes the trained story).  
- Don’t recite every pipeline card on `/model` — point at sections, offer Q&A.  
