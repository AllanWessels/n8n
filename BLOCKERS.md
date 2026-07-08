# Blockers — needs Allan's input

- [ ] Provide GCP billing account is already known (01FA1A-4B91D5-956F9E) — confirm OK to create a new project & spend
      Context: Terraform will provision a new GCP project under this billing account. No project has been created yet;
      nothing will be provisioned or spent until this is explicitly confirmed.

- [ ] Approve/verify GCP L4 GPU quota increase if Terraform apply reports quota=0
      Context: The Ollama inference host is planned to run on an L4 GPU instance for reasonable local-model latency.
      New GCP projects typically start with 0 GPU quota in most regions; a quota increase request may be required
      before `terraform apply` can provision the instance. This will only surface once Terraform is written and run.

- [ ] (Optional) Provide live Kalshi API key + PEM to switch KALSHI_MODE=live (defaults to fixtures otherwise)
      Context: `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY_PATH` (see `.env.example`) are required only when
      `KALSHI_MODE=live`. Until provided, the platform runs entirely against recorded fixture data, so development
      and testing can proceed without this.
