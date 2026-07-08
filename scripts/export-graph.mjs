#!/usr/bin/env node
// =============================================================================
// export-graph.mjs — render an n8n workflow JSON export as a Mermaid graph.
//
// Zero dependencies (Node ESM + fs/path only) so it runs anywhere Node runs,
// including inside CI, without an npm install step.
//
// Usage:
//   node scripts/export-graph.mjs <workflow.json> <output.mmd>
//
// The output is a `graph TD` Mermaid flowchart with one node per n8n
// workflow node (shaped by node type) and one edge per connection in the
// workflow's `connections` map. GitHub renders ```mermaid fences natively,
// so this needs no external tooling to view.
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function usageAndExit(message) {
  if (message) console.error(`export-graph: ${message}`);
  console.error('Usage: node scripts/export-graph.mjs <workflow.json> <output.mmd>');
  process.exit(message ? 1 : 0);
}

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  usageAndExit('missing arguments');
}

if (!existsSync(inputPath)) {
  console.error(`export-graph: input file not found: ${inputPath}`);
  process.exit(1);
}

let workflow;
try {
  const raw = readFileSync(inputPath, 'utf8');
  workflow = JSON.parse(raw);
} catch (err) {
  console.error(`export-graph: failed to read/parse ${inputPath}: ${err.message}`);
  process.exit(1);
}

const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
const connections = workflow.connections && typeof workflow.connections === 'object' ? workflow.connections : {};

if (nodes.length === 0) {
  console.error(`export-graph: warning: no "nodes" array found in ${inputPath} (writing empty graph)`);
}

// --- helpers ---------------------------------------------------------------

// Sanitize an arbitrary n8n node name into a safe Mermaid node id.
function safeId(name, fallbackIndex) {
  const base = String(name ?? `node_${fallbackIndex}`)
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1');
  return base || `node_${fallbackIndex}`;
}

// Escape text that goes inside Mermaid node/edge labels.
function escapeLabel(text) {
  return String(text ?? '').replace(/"/g, '#quot;').replace(/\n/g, ' ');
}

// Pick a Mermaid node shape based on n8n node type, so the diagram
// communicates structure (trigger vs. logic vs. output) at a glance.
function shapeFor(type, id, label) {
  const t = String(type ?? '').toLowerCase();
  const text = escapeLabel(label);
  if (t.includes('trigger') || t.includes('webhook')) {
    return `${id}(("${text}"))`; // circle — entry point
  }
  if (t.includes('if') || t.includes('switch') || t.includes('filter')) {
    return `${id}{"${text}"}`; // rhombus — branching logic
  }
  if (t.includes('set') || t.includes('function') || t.includes('code')) {
    return `${id}["${text}"]`; // rectangle — transform/logic
  }
  if (t.includes('httprequest') || t.includes('postgres') || t.includes('database') || t.includes('ollama')) {
    return `${id}[("${text}")]`; // cylinder-ish — external I/O
  }
  return `${id}["${text}"]`; // default rectangle
}

// --- build id/name lookup ---------------------------------------------------

const idById = new Map(); // n8n node "name" -> mermaid-safe id
const nameByName = new Map(); // n8n node "name" -> display label + type

nodes.forEach((node, index) => {
  const n8nName = node.name ?? `node_${index}`;
  const id = safeId(n8nName, index);
  idById.set(n8nName, id);
  nameByName.set(n8nName, { label: n8nName, type: node.type ?? 'unknown' });
});

// --- emit ---------------------------------------------------------------

const lines = ['graph TD'];

// Node declarations (shaped by type).
for (const node of nodes) {
  const n8nName = node.name;
  const id = idById.get(n8nName);
  const type = node.type ?? 'unknown';
  const shortType = String(type).split('.').pop();
  const label = `${n8nName}\\n(${shortType})`;
  lines.push(`  ${shapeFor(type, id, label)}`);
}

// Edges: n8n `connections` is keyed by source node name -> output type
// (usually "main") -> array of output branches -> array of connection
// objects with a `node` field naming the target.
let edgeCount = 0;
for (const [sourceName, outputTypes] of Object.entries(connections)) {
  const sourceId = idById.get(sourceName) ?? safeId(sourceName, `src_${edgeCount}`);
  if (!outputTypes || typeof outputTypes !== 'object') continue;
  for (const [outputType, branches] of Object.entries(outputTypes)) {
    if (!Array.isArray(branches)) continue;
    branches.forEach((branch, branchIndex) => {
      if (!Array.isArray(branch)) return;
      for (const conn of branch) {
        if (!conn || !conn.node) continue;
        const targetId = idById.get(conn.node) ?? safeId(conn.node, `dst_${edgeCount}`);
        const edgeLabel = outputType === 'main' && branches.length <= 1 ? '' : `|${escapeLabel(outputType)}:${branchIndex}|`;
        lines.push(`  ${sourceId} -->${edgeLabel} ${targetId}`);
        edgeCount += 1;
      }
    });
  }
}

if (nodes.length === 0 && edgeCount === 0) {
  lines.push('  empty["(no nodes found)"]');
}

const output = lines.join('\n') + '\n';

const outDir = dirname(outputPath);
if (outDir && !existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

writeFileSync(outputPath, output, 'utf8');
console.log(`export-graph: wrote ${nodes.length} node(s), ${edgeCount} edge(s) -> ${outputPath}`);
