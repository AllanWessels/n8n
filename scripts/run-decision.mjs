#!/usr/bin/env node
/**
 * Thin wrapper around the `@f1/app` CLI so `make e2e` (`node
 * scripts/run-decision.mjs`) has a stable, top-level entrypoint independent
 * of the package's exact dist layout. Spawns the built CLI
 * (`packages/app/dist/cli.js`), forwarding all args and the exit code.
 *
 * Requires `npm run build` (or `npx tsc -b`) to have run first so
 * `packages/app/dist/cli.js` exists.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'packages', 'app', 'dist', 'cli.js');

if (!existsSync(cliPath)) {
  console.error('packages/app/dist/cli.js not found — run `npm run build` first.');
  process.exit(1);
}

const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: repoRoot,
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
