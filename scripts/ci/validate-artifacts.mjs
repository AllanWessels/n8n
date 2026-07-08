#!/usr/bin/env node
// scripts/ci/validate-artifacts.mjs
//
// Zero-dependency validator for the platform's data artifacts:
//   1. fixtures/**/*.json  -> must parse as valid JSON.
//   2. workflows/*.json    -> must parse as valid JSON and look like an n8n
//                             workflow export: a `nodes` array (with every
//                             node having a non-empty `type`) and a
//                             `connections` object.
//
// Directories that don't exist yet (e.g. before any fixtures/workflows have
// been recorded) are treated as a pass-with-notice rather than a failure, so
// this gate can land before those directories are populated.
//
// Exit code 0 on success, 1 on any validation error.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** Recursively collect files under `dir` whose name matches `predicate`. */
async function walk(dir, predicate, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, predicate, out);
    } else if (entry.isFile() && predicate(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function relative(p) {
  return path.relative(ROOT, p);
}

async function validateFixtures(errors, notices) {
  const fixturesDir = path.join(ROOT, 'fixtures');
  if (!(await pathExists(fixturesDir))) {
    notices.push('fixtures/ does not exist yet — skipping fixture validation.');
    return 0;
  }

  const files = await walk(fixturesDir, (name) => name.endsWith('.json'));
  if (files.length === 0) {
    notices.push('fixtures/ exists but contains no *.json files — nothing to validate.');
    return 0;
  }

  let checked = 0;
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    try {
      JSON.parse(raw);
      checked += 1;
    } catch (err) {
      errors.push(`fixtures: ${relative(file)} is not valid JSON (${err.message})`);
    }
  }
  return checked;
}

async function validateWorkflows(errors, notices) {
  const workflowsDir = path.join(ROOT, 'workflows');
  if (!(await pathExists(workflowsDir))) {
    notices.push('workflows/ does not exist yet — skipping workflow validation.');
    return 0;
  }

  const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => path.join(workflowsDir, e.name));

  if (files.length === 0) {
    notices.push('workflows/ exists but contains no *.json files — nothing to validate.');
    return 0;
  }

  let checked = 0;
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    let workflow;
    try {
      workflow = JSON.parse(raw);
    } catch (err) {
      errors.push(`workflows: ${relative(file)} is not valid JSON (${err.message})`);
      continue;
    }

    if (workflow === null || typeof workflow !== 'object' || Array.isArray(workflow)) {
      errors.push(`workflows: ${relative(file)} must be a JSON object at the top level`);
      continue;
    }

    if (!Array.isArray(workflow.nodes)) {
      errors.push(`workflows: ${relative(file)} is missing a top-level "nodes" array`);
      continue;
    }

    if (
      workflow.connections === null ||
      typeof workflow.connections !== 'object' ||
      Array.isArray(workflow.connections)
    ) {
      errors.push(`workflows: ${relative(file)} is missing a top-level "connections" object`);
      continue;
    }

    if (workflow.nodes.length === 0) {
      errors.push(`workflows: ${relative(file)} has an empty "nodes" array`);
      continue;
    }

    workflow.nodes.forEach((node, idx) => {
      if (
        node === null ||
        typeof node !== 'object' ||
        typeof node.type !== 'string' ||
        node.type.trim() === ''
      ) {
        errors.push(
          `workflows: ${relative(file)} node[${idx}]${
            node && node.name ? ` (${node.name})` : ''
          } has a missing or empty "type"`,
        );
      }
    });

    checked += 1;
  }
  return checked;
}

async function main() {
  const errors = [];
  const notices = [];

  const fixturesChecked = await validateFixtures(errors, notices);
  const workflowsChecked = await validateWorkflows(errors, notices);

  for (const notice of notices) {
    console.log(`NOTICE: ${notice}`);
  }

  console.log(
    `Checked ${fixturesChecked} fixture file(s) and ${workflowsChecked} workflow file(s).`,
  );

  if (errors.length > 0) {
    console.error(`\nFound ${errors.length} artifact validation error(s):`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('All artifacts valid.');
}

main().catch((err) => {
  console.error('validate-artifacts.mjs crashed:', err);
  process.exitCode = 1;
});
