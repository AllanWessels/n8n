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

// Escape text that goes inside Mermaid node/edge labels. Real newlines (and
// literal two-character "\n" sequences baked into a label string) are turned
// into `<br/>` so Mermaid renders an actual line break instead of the raw
// escape sequence.
function escapeLabel(text) {
  return String(text ?? '')
    .replace(/"/g, '#quot;')
    .replace(/\r\n|\n/g, '<br/>')
    .replace(/\\n/g, '<br/>');
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

// n8n's `stickyNote` nodes are canvas annotations, not part of the
// executable graph (they carry no `main` connections in or out) — skip them
// entirely so the exported diagram only shows real pipeline nodes.
function isStickyNote(node) {
  return String(node?.type ?? '').toLowerCase() === 'n8n-nodes-base.stickynote';
}

const idById = new Map(); // n8n node "name" -> mermaid-safe id (ALL nodes, so
// edges referencing a sticky note - unlikely, but possible - still resolve).
const typeByName = new Map(); // n8n node "name" -> type, used to skip sticky-note edges below.

nodes.forEach((node, index) => {
  const n8nName = node.name ?? `node_${index}`;
  const id = safeId(n8nName, index);
  idById.set(n8nName, id);
  typeByName.set(n8nName, node.type ?? 'unknown');
});

// --- emit ---------------------------------------------------------------

const lines = ['graph TD'];

// Node declarations (shaped by type). Sticky notes are skipped (see
// isStickyNote above) — they're canvas documentation, not pipeline steps.
for (const node of nodes) {
  if (isStickyNote(node)) continue;
  const n8nName = node.name;
  const id = idById.get(n8nName);
  const type = node.type ?? 'unknown';
  const shortType = String(type).split('.').pop();
  const label = `${n8nName}<br/>(${shortType})`;
  lines.push(`  ${shapeFor(type, id, label)}`);
}

// Edges: n8n `connections` is keyed by source node name -> output type
// (usually "main") -> array of output branches -> array of connection
// objects with a `node` field naming the target.
let edgeCount = 0;
for (const [sourceName, outputTypes] of Object.entries(connections)) {
  // Skip any edge touching a sticky note (source or target) — sticky notes
  // are canvas documentation, not part of the executable graph.
  if (String(typeByName.get(sourceName) ?? '').toLowerCase() === 'n8n-nodes-base.stickynote') continue;
  const sourceId = idById.get(sourceName) ?? safeId(sourceName, `src_${edgeCount}`);
  if (!outputTypes || typeof outputTypes !== 'object') continue;
  for (const [outputType, branches] of Object.entries(outputTypes)) {
    if (!Array.isArray(branches)) continue;
    branches.forEach((branch, branchIndex) => {
      if (!Array.isArray(branch)) return;
      for (const conn of branch) {
        if (!conn || !conn.node) continue;
        if (String(typeByName.get(conn.node) ?? '').toLowerCase() === 'n8n-nodes-base.stickynote') continue;
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
const emittedNodeCount = nodes.filter((n) => !isStickyNote(n)).length;
const skippedStickyCount = nodes.length - emittedNodeCount;
const stickyNote =
  skippedStickyCount > 0 ? ` (skipped ${skippedStickyCount} stickyNote node(s))` : '';
console.log(
  `export-graph: wrote ${emittedNodeCount} node(s), ${edgeCount} edge(s) -> ${outputPath}${stickyNote}`,
);
