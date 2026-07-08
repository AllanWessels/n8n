#!/bin/bash
# =============================================================================
# ollama-startup.sh — GCE startup-script for the Ollama GPU inference host
# =============================================================================
# Runs on every boot of an instance created from the f1-decision-platform
# Ollama instance template. The boot disk image is a GCP "Deep Learning VM"
# image family (common-cu121-debian-11) which ships with the NVIDIA driver
# and CUDA already installed, so this script only needs to install Ollama
# itself, expose it on all interfaces (so Cloud Run can reach it through the
# internal load balancer / VPC connector), and pre-pull the models the
# pipeline depends on.
set -euo pipefail

log() { echo "[ollama-startup] $*"; }

# --- Install Ollama --------------------------------------------------------
if ! command -v ollama >/dev/null 2>&1; then
  log "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
else
  log "Ollama already installed, skipping install."
fi

# --- Configure the systemd unit to listen on all interfaces ----------------
# The official installer creates /etc/systemd/system/ollama.service already;
# override it so Ollama binds 0.0.0.0:11434 instead of localhost-only, which
# is required for Cloud Run (via the internal LB / VPC connector) to reach it.
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=30m"
EOF

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama

# --- Wait for the API to come up, then pull the models the pipeline uses ---
log "Waiting for Ollama API..."
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

log "Pulling models (this can take several minutes on first boot)..."
ollama pull qwen2.5:14b-instruct || log "WARNING: failed to pull qwen2.5:14b-instruct"
ollama pull qwen2.5:7b-instruct || log "WARNING: failed to pull qwen2.5:7b-instruct"

log "Startup script complete."
