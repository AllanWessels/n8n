# workflows/

Importable n8n workflow exports that visually orchestrate the F1/Kalshi
decision pipeline. These are the visual centerpiece of the project — they
map 1:1 onto the TypeScript logic in `packages/core`, `packages/f1model`,
and `packages/kalshi`, but rendered as an inspectable, screenshot-able graph.

## Files

### `00-decision-framework.json` — *Decision Framework (reusable)*

The domain-agnostic decision core, packaged as a callable sub-workflow.
Entered via an **Execute Sub-workflow Trigger** (`domain`, `subject`,
`evidence`), it runs:

1. **AI Agent: Analyst** (+ its own **Ollama Chat Model**, `qwen2.5:14b-instruct`)
   produces a structured `{ probability, reasoning, keyFactors }` assessment
   from the evidence bundle — mirrors `packages/core/src/agent.ts`.
2. **AI Agent: Judge (rubric)** (+ its own **Ollama Chat Model**) independently
   scores that assessment 0-1 against a weighted rubric (accuracy /
   evidence_use / calibration / clarity) — mirrors `packages/core/src/judge.ts`.
3. **Code: Guardrail + Policy Gate** computes the rubric's weighted overall
   score, a pass/revise/reject verdict, and applies policy guardrails
   (`minConfidence`, banned-subject list) — mirrors
   `packages/core/src/guardrail.ts:checkDecisionPolicy`.
4. **If: Approved?** branches to `Decision: Approved` / `Decision: Rejected`,
   each shaping the final decision object returned to the caller.

This workflow has no domain-specific (F1/Kalshi) logic and no triggers of
its own beyond the sub-workflow entry point — it's designed to be called
once per decision by `10-f1-edge-flagship.json`.

### `10-f1-edge-flagship.json` — *F1 Kalshi Edge Engine (flagship)*

The full end-to-end pipeline, with four stages (see the sticky notes on the
canvas):

- **① Parallel ingest** — three trigger types (a JWT-secured **Webhook**,
  a **Schedule Trigger**, and a **Manual Trigger** for ad-hoc runs) converge
  on a `Code: prepare/warmup` node, which fans out to 5 independent, parallel
  live data sources: Jolpica standings, OpenF1 weather, Open-Meteo forecast,
  Kalshi KXF1 markets, and the Autosport F1 RSS feed. All 5 `HTTP Request` /
  `RSS Read` nodes use `options.retry` (3 retries) for resilience, then a
  **Merge** node (`combine`/`combineAll`) joins them back into one item.
- **② Per-market loop** — `Code: build evidence + win-probabilities` inlines
  the softmax win-probability model from `packages/f1model/src/model.ts`
  (championship points + form/news/prior signals, weather-compressed,
  numerically-stable softmax), then a **Loop Over Items** (SplitInBatches,
  batch size 1) walks the Kalshi KXF1 markets one at a time. Output 0
  ("done") feeds the ledger-write stage; output 1 ("loop") feeds the
  per-market decision stage below, looping back once each market is scored.
- **③ Agent + LLM-judge** — each loop iteration calls the reusable
  `00-decision-framework.json` sub-workflow via **Execute Sub-workflow**,
  then `Code: compute edge + size` inlines the betting-edge math from
  `packages/f1model/src/edge.ts` (implied probability from `yes_bid`/
  `yes_ask` cents, `edge = modelProb - impliedProb`, BUY/PASS/HOLD action,
  half-Kelly sizing) plus a final policy gate (`maxExposureUsd`,
  banned-tickers), before looping back into the SplitInBatches node.
- **④ Governance gate + ledger** — once the loop is done, **Postgres: insert
  decision_ledger** writes every decision to the `decision_ledger` table
  (see `db/schema.sql`), an **If: any BUY?** node checks whether any market
  cleared to BUY, and **Respond to Webhook** returns the result JSON to
  whatever caller (if any) triggered the run via the webhook.

**Note on `Execute Sub-workflow: Decision Framework`**: it references
`00-decision-framework.json` by a placeholder `workflowId` value
(`"00-decision-framework"`). After importing both workflows, open this node
in the n8n editor and repoint it at the actual imported ID/name for
`Decision Framework (reusable)` — n8n assigns IDs at import time, so a
static cross-file reference can't be baked in ahead of time.

**Note on the JWT webhook**: the `Webhook (JWT)` trigger node has
`authentication: "jwtAuth"` set, demonstrating a secured (not anonymous)
inbound trigger. The actual JWT credential is configured out-of-band in the
n8n UI/credentials store — it is intentionally not part of this JSON export
(credentials never belong in a workflow file).

### `90-warmup-ping.json` — *GPU Warm-up Ping*

A small (6-node) cold-start mitigation workflow: a **Manual Trigger** /
**Schedule Trigger** (every 15 min) call `HTTP: Ollama /api/tags`, an
**If: model ready?** node checks whether `qwen2.5:14b-instruct` is already
loaded, and if not, a **Wait** node pauses 10s and loops back to re-poll.
Once ready, `Code: report warm` emits a small status object. Run this ahead
of the flagship pipeline (or on a schedule) so the first real AI Agent /
judge call in `10-f1-edge-flagship.json` doesn't pay a multi-minute
model-load penalty.

## Node types used

Trigger nodes: `manualTrigger`, `webhook` (v2, JWT auth), `scheduleTrigger`,
`executeWorkflowTrigger`. Data/compute: `httpRequest` (with retry options),
`rssFeedRead`, `merge`, `splitInBatches`, `code`, `postgres`. Control flow:
`if`, `executeWorkflow`, `respondToWebhook`, `wait`. AI:
`@n8n/n8n-nodes-langchain.agent` + `@n8n/n8n-nodes-langchain.lmChatOllama`
(connected via the non-`main` `ai_languageModel` connection type).
Documentation: `stickyNote`.

## How to import

Via the project's Makefile, against the running `f1-n8n` container from
`docker-compose.yml`:

```bash
make up                # start postgres/n8n/ollama
make import-workflows  # docker exec f1-n8n n8n import:workflow --separate --input=/workflows
```

Importing does **not** activate the workflows (webhook triggers etc. need
an explicit activation step) — see the note printed by `make
import-workflows`, or toggle "Active" in the n8n UI at
`http://localhost:5678`.

### Standalone / CI validation (no compose stack required)

These files were also validated directly against a throwaway n8n container,
independent of the rest of the stack:

```bash
docker run --rm -e DB_TYPE=sqlite -v "$PWD/workflows:/wf" \
  --entrypoint n8n n8nio/n8n import:workflow --separate --input=/wf
```

This is the same check `scripts/ci/validate-artifacts.mjs` complements at
the structural level (every workflow has a non-empty `nodes` array with a
`type` on every node, and a `connections` object).
