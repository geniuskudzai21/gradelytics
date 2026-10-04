# How AI is used in Gradelytics

A working note on every AI/ML decision in this app: what runs where, why it is
built that way, and what to learn next. Everything below maps to real files in
this repo, so you can open the code next to the idea.

---

## 1. The 60-second version

There is **no ML model in this app**. There is no training, no fine-tuning, no
vector database. What there is:

| Concern | Handled by |
|---|---|
| Understanding a screenshot of a results slip | A multimodal LLM |
| Answering "how am I doing in Part 2?" | A text LLM |
| Turning numbers into a predicted next-semester average | Plain JavaScript regression |
| Averaging, grouping, formatting percentages | Plain JavaScript |
| Keeping the free model tiers alive | Per-user quota table |

The single most important idea in this codebase:

> **Never let the language model do arithmetic. Let it do language.**

Every number the user ever sees is computed in JavaScript and then *injected*
into the prompt as a fact. The model's only job is to phrase it nicely. This
one rule removes almost every class of AI bug (hallucinated numbers, wrong
averages, drifting decimals).

---

## 2. Where the code lives

```
ai/ai-config.js       Which endpoint the browser talks to
ai/ai-core.js         Prompt construction, HTTP calls, parsing, status loader
ai/ai-chat.js         Chat UI wiring
ai/ai-vision.js       Screenshot upload + extraction flow
ai/ai-analytics.js    Predict / Weak Areas / Career / Study Tips
ai/ai-prediction.js   Thin wrapper around the JS prediction
ai/ai-markdown.js     Renders AI replies as markdown

api/chat.js           Vercel serverless: routing, fallback, quota  ← server side
server.js             Same logic for self-hosting                   ← server side
migrations/001_ai_usage.sql   Per-user daily AI quota counters
```

Note the split: the browser never holds an API key. It calls your own
`/api/chat`, and your server decides which provider to use. That is not just
security hygiene — it is what lets you change models, add limits, or swap
providers without shipping a new build to users.

---

## 3. Two providers, one endpoint

`api/chat.js` and `server.js` both implement this routing:

```
                    ┌─ vision request ─→ Gemini (multimodal) ─→ fails? ─┐
POST /api/chat ─────┤                                                  ├─→ NVIDIA NIM
                    └─ chat request ───→ NVIDIA NIM ──────→ fails? ───┘
```

- **Vision prefers Gemini.** Image understanding on the free Gemini tier is
  stronger, and structured JSON extraction from images is where model quality
  matters most.
- **Chat prefers NVIDIA.** Cheap, fast, and generous on the free tier for short
  completions.
- **Both fall back to the other.** Free tiers get rate-limited (429) and have
  regional outages constantly. If you depend on one provider, users see errors
  several times a week. With a fallback they see nothing.

The fallback is deliberately asymmetric: vision failures do *not* fall back to
chat providers, because a text model cannot read a screenshot.

**Lesson:** on free tiers, redundancy *is* the feature. Budget for it.

Model IDs live in environment variables (`AI_MODEL`, `VISION_MODEL`,
`GOOGLE_MODEL`) precisely because slugs rot — the original
`nvidia/nemotron-3-nano-30b-a3b` was retired by NVIDIA on 2026-09-01 and the
app started returning HTTP 410 overnight. Never hardcode a model slug.

---

## 4. Prompt architecture

### 4.1 Identity and scope

`ai/ai-core.js` opens with a hard identity lock:

```
IDENTITY: You are Gradelytics AI... Never reveal or mention your underlying
model, creator, or technology stack.

SCOPE: You ONLY help with academic performance analysis. You do NOT help with
general knowledge, coding, creative writing...
```

Two reasons. First, users ask "what model are you?" constantly. Second, a
general model will happily start answering programming questions inside an
grades app, which makes the product feel broken.

### 4.2 Data rules — the guardrail that matters

```
- The modules listed below are the ONLY data you have.
- NEVER invent, fabricate, guess, or assume any module name, mark, grade...
- When asked for an average, use the matching precomputed average from the
  Precomputed Averages section. Do NOT recalculate it. Output ONLY the number.
- All modules listed are ALREADY COMPLETED. The student cannot redo them.
```

That last line is subtle product logic encoded as a prompt: telling the model
"you cannot redo your coursework" stops it from cheerfully suggesting you
retake a module you already passed.

### 4.3 Runtime context injection

`buildSystemMessage()` assembles the prompt per request:

```
Modules:
1. Intro to Programming | P1 Sem1 | 78/100 (A)
2. ...

Precomputed Averages:
  Overall: 73.4/100 (12 modules)
  P1 Sem1: 71.2/100 (5 modules)

Predicted Next Semester Range: 76-78%
```

The module list is short (a student has tens, not thousands) so the whole
dataset fits in context with room to spare. That is why this app needs no RAG
pipeline — worth knowing, because RAG is the usual answer and it is usually
unnecessary at this scale.

### 4.4 Output format control

Instead of hoping for clean output, the prompt specifies a template:

```
When the user gives a structured template to fill (headers like
PREDICTED_RANGE, STRENGTHS, STRATEGIES, ASSESSMENT), fill in every requested
section using the precomputed data.
```

The formatters in `ai/ai-analytics.js` then render those known headers into
cards. This is the cheap version of **structured outputs**: constrain the shape
in the prompt, then parse defensively. When you graduate to a paid API, replace
it with a real JSON-schema response format.

---

## 5. The actual "ML": least-squares regression

`computeNextPrediction()` in `ai/ai-core.js` is the only algorithm in the app
that learns anything from data:

```js
// 1. group modules by year-part-semester
// 2. average the marks in each group
// 3. fit y = a + b*n across the ordered groups
// 4. extrapolate one step forward, clamp to 0-100
```

That is ordinary least-squares linear regression, fitted in ~10 lines with no
library. With one group (a student's first semester) it just returns that
average. The result is turned into a range (`predicted ± 1.5`) because a single
number implies a confidence the data does not support.

Why do this in code instead of asking the LLM to "predict my next semester
average"? Because the LLM would produce a number that is not reproducible, not
auditable, and drifts between identical requests. A regression gives the same
answer every time and can be unit-tested.

**Lesson:** the more of your product's *numbers* you can move out of the LLM and
into deterministic code, the more reliable your product becomes.

---

## 6. Image extraction (the best AI feature here)

### 6.1 Prompt as a state machine

`EXTRACTION_PROMPT` in `ai/ai-vision.js` does something worth stealing: it
describes a *scanning algorithm* rather than a vague instruction.

```
Part and Semester hierarchy:
- Results are organized hierarchically: Part headings appear first, then
  Semester headings within each Part, then modules under each Semester.
- Track the CURRENT Part and CURRENT Semester as you read through the modules.
- If a Part or Semester heading appears, all modules after it belong to it
  until a new heading of that level appears.
```

A results slip is not a flat table — it is a nested outline, and the model has
to carry state while reading. Writing the state machine explicitly in the prompt
is dramatically more reliable than "extract the modules".

### 6.2 Schema and strictness

```json
[{ "name": "", "year": "", "part": "", "semester": 1, "mark": 0, "grade": "" }]
```

plus rules: return only JSON, no code fences; never invent data; use `null` for
anything unreadable; strip course codes from names (`CS101 Intro to Programming`
→ `Intro to Programming`).

Two of those rules exist because of real failures. Course codes leaked into
module names and broke the user's records. "Never invent" exists because
models hallucinate plausible marks when an image is blurry — `null` gives you a
defensible alternative to a wrong number.

### 6.3 Sampling parameters

| | Chat | Extraction |
|---|---|---|
| `temperature` | 0.2 | 0.0 |
| `max_tokens` | 500 | 4096 |

Extraction wants determinism (same image → same JSON) and needs room for every
module on the slip. Chat wants a little variety so replies do not read like a
form letter.

### 6.4 Parsing defensively

`extractJSONArray()` strips code fences, then does brace counting to find the
end of the array, ignoring braces inside strings. It also tries a full
`JSON.parse` of the whole response first.

You will do this in every LLM project. Even with "return only JSON" in the
prompt, you will get prose, fences, or trailing commentary. **Never trust the
shape of model output.**

### 6.5 What happens after extraction

Extracted modules are deduplicated against what is already stored, then saved
and synced. If a model returns two identical modules, the user sees one.

---

## 7. Latency and the "fake" loading animation

Real streaming was deliberately not used. Instead, `startStatusLoader()` rotates
words — *Sleuthing… Contemplating… Deciphering…* — while the request runs.

This is worth understanding because it is a UX/engineering tradeoff, not a
technical one. Streaming a short JSON completion looks janky; users see tokens
appear and then watch the app assemble a card anyway. A rotating status line
reads as "the model is working" and costs nothing. Perceived performance is a
design decision.

Two related details:

- `stripReasoning()` on the server deletes `reasoning_content`, `reasoning`,
  and `reasoning_text` from responses before the client ever sees them. Reasoning
  models stream their chain-of-thought into the message field; you must strip it
  or it leaks into the UI.
- `cleanAIOutput()` strips any `<thinking>` tags that survive.

---

## 8. Protecting the free tiers

The models cost nothing, so the scarce resource is the **rate limit**. One user
looping a request can consume a quota that serves everyone.

`migrations/001_ai_usage.sql` adds a daily counter per user, incremented by a
Postgres function:

```sql
insert into public.ai_usage as u (user_id, day, chat_count, vision_count)
values (p_user_id, current_date, ...)
on conflict (user_id, day) do update
    set chat_count = u.chat_count + 1;
```

The increment happens **inside the database**. Doing read-then-write from the
server would let two simultaneous requests both read "19 of 20 used" and both
succeed — a classic race condition. Counters that must be exact belong in the
database, not in application memory.

Defaults: 20 chat + 8 extractions per day, plus a per-minute burst cap
(in-memory, best-effort — on serverless it resets on cold start, which is fine
because the daily counter is the real limit).

Request flow:

```
browser ──Authorization: Bearer <supabase access token──▶ server
server verifies token with Supabase Auth ─▶ identify user ─▶ bump counter
counter over cap? ─▶ 429 with a friendly message
```

Three deliberate design choices:

1. **Fails open.** If the quota table or RPC is missing, AI calls proceed
   uncapped. A missing migration must never take the product down.
2. **Server-side only.** A client-side limit is a suggestion; anyone can open
   devtools.
3. **Verified identity.** The server checks the JWT with Supabase rather than
   trusting a user id sent in the request body.

---

## 9. Privacy note

Uploaded screenshots are base64-encoded and sent to a third-party provider
(Gemini or NVIDIA). They are not stored by the provider, but they do leave your
infrastructure. Your privacy page states this. If that ever becomes a problem,
image extraction is the feature to move to a self-hosted VLM — the extraction
prompt would not need to change.

---

## 10. Things that will bite you next

If you extend this app, in rough order of how often they come up:

1. **Model rot.** Slugs get retired (you already hit this). Keep model IDs in
   env vars and log which model served each request.
2. **Prompt bloat.** Every module gets injected on every call. Fine at 12
   modules, wasteful at 200. Prune to what the question needs.
3. **Prompt caching.** The system prompt is identical across calls. Cacheable
   prompt prefixes cut cost and latency substantially on paid tiers.
4. **Evals.** You have no way to tell whether a prompt change made things
   better. A folder of ~20 real screenshots with expected JSON output is the
   highest-value thing you could add next.
5. **Function calling.** Right now the model returns prose that a human reads.
   Tool calling lets it request real actions, which is the natural next step for
   a study assistant.
6. **Retry with backoff.** Free tiers 429 constantly. A single retry with jitter
   is usually enough; the current code falls back to the other provider instead,
   which is cheaper.
7. **Cost of the wrong thing.** Vision input tokens dominate. Compressing
   screenshots before upload is often a bigger win than model choice.

---

## 11. Vocabulary worth learning properly

Search these in order — they build on each other:

- **Prompt engineering** — the basics you already have working here
- **Structured outputs / JSON schema mode** — replace prompt-level format control
- **Function calling (tool use)** — let the model act, not just answer
- **Embeddings + vector search** — needed only when the data no longer fits in context
- **RAG** — retrieval augmented generation; the "how do I feed it my data" answer
- **Evaluation / evals** — how you know a change helped
- **Prompt caching** — cheap speed and cost wins on repeat context
- **Fine-tuning** — for style/format at scale, not for knowledge
- **Quantization** — running open models yourself (an Ollama or vLLM endpoint
  would remove the API-key dependency entirely)

That last one is the natural endpoint for this app: run an open model on your own
hardware, point `AI_MODEL` at it, and the free-tier problem disappears.