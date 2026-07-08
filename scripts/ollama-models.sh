#!/usr/bin/env bash
# =============================================================================
# ollama-models.sh — pull the local models used by the decision pipeline.
#
# Works two ways:
#   1. Against a host-installed Ollama (default) — `ollama pull ...`
#   2. Against the `f1-ollama` docker container — pass `--docker`
#
# Models pulled (override via env, matches .env.example):
#   OLLAMA_MODEL_AGENT   default: qwen2.5:14b-instruct
#   OLLAMA_MODEL_ENRICH  default: qwen2.5:7b-instruct
#   OLLAMA_MODEL_JUDGE   default: qwen2.5:14b-instruct  (dedup'd automatically)
#
# Usage:
#   scripts/ollama-models.sh            # pull via host `ollama` CLI
#   scripts/ollama-models.sh --docker   # pull via `docker exec f1-ollama`
# =============================================================================

set -euo pipefail

MODE="host"
if [[ "${1:-}" == "--docker" ]]; then
  MODE="docker"
fi

MODEL_AGENT="${OLLAMA_MODEL_AGENT:-qwen2.5:14b-instruct}"
MODEL_ENRICH="${OLLAMA_MODEL_ENRICH:-qwen2.5:7b-instruct}"
MODEL_JUDGE="${OLLAMA_MODEL_JUDGE:-qwen2.5:14b-instruct}"

# De-duplicate (agent and judge often share a model).
MODELS="$(printf '%s\n%s\n%s\n' "${MODEL_AGENT}" "${MODEL_ENRICH}" "${MODEL_JUDGE}" | sort -u)"

pull_host() {
  local model="$1"
  if ! command -v ollama >/dev/null 2>&1; then
    echo "ERROR: 'ollama' CLI not found on PATH. Install from https://ollama.com or use --docker." >&2
    exit 1
  fi
  echo "Pulling ${model} (host ollama)..."
  ollama pull "${model}"
}

pull_docker() {
  local model="$1"
  echo "Pulling ${model} (docker exec f1-ollama)..."
  docker exec f1-ollama ollama pull "${model}"
}

echo "=== f1-decision-platform: pulling Ollama models (mode=${MODE}) ==="
while IFS= read -r model; do
  [[ -z "${model}" ]] && continue
  if [[ "${MODE}" == "docker" ]]; then
    pull_docker "${model}"
  else
    pull_host "${model}"
  fi
done <<< "${MODELS}"

echo
echo "Done. Models available:"
echo "${MODELS}" | sed 's/^/  - /'
