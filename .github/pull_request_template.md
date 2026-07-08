<!--
Thanks for the contribution! Please fill out this template — the CI pipeline
(build/lint/coverage gate, artifact & terraform validation, secret scan, and
the adversarial AI reviewer) will run automatically once this PR is opened.
See .github/workflows/README.md for details on the pipeline.
-->

## What / Why

<!-- What does this PR change, and why? Link any relevant issue/ticket. -->

## Tests added

<!-- What tests were added or updated to cover this change? If no tests were
     needed, explain why (e.g. docs-only change). -->

## Attribute(s) touched

<!-- Which component(s)/package(s) does this touch? Link to the relevant row(s)
     in the root README's component/attribute matrix. -->

## Checklist

- [ ] `npm run build`, `npm run lint`, and `npm run test:cov` pass locally
- [ ] Test coverage is ≥ 80% (lines/functions/statements) and ≥ 75% (branches) — see `vitest.config.ts`
- [ ] No secrets, API keys, or credentials are included in this diff
- [ ] Any new/changed `fixtures/**/*.json` or `workflows/*.json` are valid (see `scripts/ci/validate-artifacts.mjs`)
- [ ] Docs updated where relevant (README, `PROGRESS.md`, `BLOCKERS.md`, etc.)
- [ ] If this PR intentionally overrides a high-severity adversarial AI review finding, the `override-ai-review` label is applied with an explanation in a PR comment
