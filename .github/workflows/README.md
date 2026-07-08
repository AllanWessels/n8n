# CI/CD pipeline

This directory defines the GitHub Actions pipeline for `f1-decision-platform`:
a layered CI gate (`ci.yml`) on every PR/branch push, and a WIF-based CD
deploy (`cd.yml`) on push to `main`.

## `ci.yml` — runs on pull_request and push (branches other than `main`)

| Job                  | What it does                                                                                                                        | Blocking? |
|----------------------|----------------------------------------------------------------------------------------------------------------------------------------|-----------|
| `build-test`         | `npm ci` → `npm run build` (tsc -b) → `npm run lint` → `npm run test:cov` (vitest, coverage gate enforced by `vitest.config.ts`: 80% lines/functions/statements, 75% branches). Coverage report uploaded as a build artifact. | Yes |
| `validate-artifacts` | Runs `scripts/ci/validate-artifacts.mjs`: every `fixtures/**/*.json` must parse as JSON; every `workflows/*.json` must parse as JSON and look like a valid n8n workflow export (`nodes` array with non-empty `type` on every node, `connections` object). Passes with a notice if `fixtures/`/`workflows/` don't exist yet. | Yes |
| `terraform`           | `terraform -chdir=infra/terraform fmt -check`, `init -backend=false`, `validate`. No plan/apply on PRs — no GCP credentials are used here. Skips with a notice if `infra/terraform` doesn't exist yet. | Yes |
| `security`            | `gitleaks/gitleaks-action` secret scan (blocking) + `npm audit --audit-level=high` (non-blocking, `|| true`). | Secret scan yes, audit no |
| `adversarial-review`  | See below. Runs only on `pull_request` events. | Yes, on high-severity findings (see override below) |

## The adversarial AI reviewer (`adversarial-review` job)

This is the headline gate. It runs entirely inside the CI runner with no
external LLM API dependency:

1. Installs Ollama (`curl -fsSL https://ollama.com/install.sh | sh`) and
   starts the server (`ollama serve &`).
2. Pulls a small, CI-fast model: `qwen2.5:3b`.
3. Runs `scripts/ci/ai-review.mjs`, which:
   - Computes the PR diff (`git fetch origin $BASE_REF && git diff
     origin/$BASE_REF...HEAD`), truncating very large diffs.
   - Sends the diff to the local Ollama OpenAI-compatible endpoint
     (`http://localhost:11434/v1/chat/completions`, model `qwen2.5:3b`) with
     an **adversarial** reviewer system prompt and a fixed rubric:
     correctness, security, test coverage, error handling, simplicity.
   - Parses the model's JSON findings (tolerant parsing — extracts the first
     balanced JSON object even if the model wraps it in prose).
   - Writes a Markdown report to the job's step summary
     (`$GITHUB_STEP_SUMMARY`), and — if a `GITHUB_TOKEN` is available — posts
     the same report as a PR comment.
   - Exits non-zero (blocking the job) if there is at least one `high`
     severity finding, **unless** the PR carries the `override-ai-review`
     label. `medium`/`low` findings are advisory only and never block.

**Infra flakiness never blocks the pipeline.** If Ollama fails to start, the
model pull fails, the endpoint is unreachable, or the model's output can't be
parsed as JSON, the script logs a warning, writes a "review skipped" notice to
the step summary, and exits `0`. Only a real, successfully-parsed `high`
severity finding blocks the merge.

### Overriding a blocking finding

If a high-severity finding is a false positive or an accepted risk, apply the
`override-ai-review` label to the PR (create it once in the repo's Labels
settings) and explain why in a PR comment. Re-run the `adversarial-review`
job (or push a new commit) and it will pass.

## `cd.yml` — deploy on push to `main`

Guarded end-to-end by `if: ${{ vars.ENABLE_CD == 'true' }}` on the `deploy`
job — it is a safe no-op until explicitly enabled. Uses OIDC / Workload
Identity Federation for GCP auth (no long-lived JSON service-account keys).

### Required repository secrets

Configure under **Settings → Secrets and variables → Actions → Secrets**:

| Secret                | Purpose |
|------------------------|---------|
| `GCP_WIF_PROVIDER`     | Full resource name of the Workload Identity Federation provider, e.g. `projects/123456789/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`. |
| `GCP_DEPLOY_SA`        | Email of the GCP service account to impersonate, e.g. `deployer@PROJECT_ID.iam.gserviceaccount.com`. |
| `GCP_PROJECT_ID`       | Target GCP project id — passed to Terraform as `-var project_id=...` and used for Artifact Registry image tags. |
| `GCP_TFSTATE_BUCKET`   | GCS bucket name used as the Terraform remote state backend. |

### Required repository variables

Configure under **Settings → Secrets and variables → Actions → Variables**:

| Variable     | Purpose |
|--------------|---------|
| `ENABLE_CD`  | Must be the literal string `true` to allow the `deploy` job to run. Unset/anything else = safe no-op. |

### What `deploy` does once enabled

1. Authenticates via `google-github-actions/auth` (WIF) and sets up `gcloud`.
2. If `docker/n8n.Dockerfile` exists, builds and pushes a custom n8n image to
   Artifact Registry; otherwise skips the build and infra references the
   upstream n8n image.
3. Runs `terraform -chdir=infra/terraform init` against the GCS backend
   (`GCP_TFSTATE_BUCKET`) and `apply -auto-approve -var
   project_id=$GCP_PROJECT_ID`.

See `BLOCKERS.md` at the repo root for outstanding approvals needed before
this is turned on (new GCP project/billing confirmation, GPU quota).
