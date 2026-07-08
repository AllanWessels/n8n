#!/usr/bin/env node
// render-n8n-canvas.mjs
//
// Turns an n8n workflow export (JSON) into a polished PNG that mimics the
// n8n editor canvas: dot-grid background, white rounded node cards with
// colored icon tiles, trigger-shaped nodes, translucent sticky-note panels,
// and bezier connector curves (including dashed purple ai_languageModel
// sub-connections). Zero npm dependencies — shells out to system Chrome for
// the actual rasterization.
//
// Usage:
//   node scripts/render-n8n-canvas.mjs <workflow.json> <out.png>

import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME_BIN = process.env.CHROME_BIN || '/opt/google/chrome/chrome';

const NODE_W = 200;
const NODE_H = 80;
const STICKY_DEFAULT_W = 240;
const STICKY_DEFAULT_H = 160;
const PADDING = 80;
const ICON_SIZE = 46;

// ---------------------------------------------------------------------------
// Per-node-type styling: icon tile color + glyph, plus whether it renders
// with the n8n "trigger" shape (rounded/half-circle left edge).
// ---------------------------------------------------------------------------
const TYPE_STYLE = {
  'n8n-nodes-base.manualTrigger': { color: '#909298', glyph: '▶', trigger: true },
  'n8n-nodes-base.scheduleTrigger': { color: '#52b0e7', glyph: '⏰', trigger: true },
  'n8n-nodes-base.webhook': { color: '#885577', glyph: '🔗', trigger: true },
  'n8n-nodes-base.executeWorkflowTrigger': { color: '#ff6d5a', glyph: '⤵', trigger: true },

  'n8n-nodes-base.httpRequest': { color: '#0088cc', glyph: '🌐' },
  'n8n-nodes-base.rssFeedRead': { color: '#ee802f', glyph: '📰' },
  'n8n-nodes-base.code': { color: '#ff6d5a', glyph: '{ }' },
  'n8n-nodes-base.merge': { color: '#00bcd4', glyph: '⇹' },
  'n8n-nodes-base.splitInBatches': { color: '#007755', glyph: '🔁' },
  'n8n-nodes-base.if': { color: '#408000', glyph: '？' },
  'n8n-nodes-base.postgres': { color: '#336791', glyph: '🗄' },
  'n8n-nodes-base.executeWorkflow': { color: '#4423b8', glyph: '⧉' },
  'n8n-nodes-base.respondToWebhook': { color: '#909298', glyph: '↩' },
  'n8n-nodes-base.set': { color: '#0aa3a3', glyph: '✎' },
  'n8n-nodes-base.wait': { color: '#919191', glyph: '⏳' },

  '@n8n/n8n-nodes-langchain.agent': { color: '#ea4b71', glyph: '🤖' },
  '@n8n/n8n-nodes-langchain.lmChatOllama': { color: '#ea4b71', glyph: '🧠' },
};
const DEFAULT_STYLE = { color: '#6b6f80', glyph: '●' };

const TYPE_LABEL = {
  'n8n-nodes-base.manualTrigger': 'Manual Trigger',
  'n8n-nodes-base.scheduleTrigger': 'Schedule Trigger',
  'n8n-nodes-base.webhook': 'Webhook',
  'n8n-nodes-base.executeWorkflowTrigger': 'Execute Workflow Trigger',
  'n8n-nodes-base.httpRequest': 'HTTP Request',
  'n8n-nodes-base.rssFeedRead': 'RSS Read',
  'n8n-nodes-base.code': 'Code',
  'n8n-nodes-base.merge': 'Merge',
  'n8n-nodes-base.splitInBatches': 'Loop Over Items',
  'n8n-nodes-base.if': 'If',
  'n8n-nodes-base.postgres': 'Postgres',
  'n8n-nodes-base.executeWorkflow': 'Execute Workflow',
  'n8n-nodes-base.respondToWebhook': 'Respond to Webhook',
  'n8n-nodes-base.set': 'Edit Fields (Set)',
  'n8n-nodes-base.wait': 'Wait',
  '@n8n/n8n-nodes-langchain.agent': 'AI Agent',
  '@n8n/n8n-nodes-langchain.lmChatOllama': 'Ollama Chat Model',
};

function typeLabel(type) {
  if (TYPE_LABEL[type]) return TYPE_LABEL[type];
  const short = type.split('.').pop().replace(/^n8n-nodes-base\./, '');
  return short.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStickyContent(md) {
  let s = escapeHtml(md);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/^######\s*(.+)$/gm, '<div class="sticky-h3">$1</div>');
  s = s.replace(/^#####\s*(.+)$/gm, '<div class="sticky-h3">$1</div>');
  s = s.replace(/^####\s*(.+)$/gm, '<div class="sticky-h3">$1</div>');
  s = s.replace(/^###\s*(.+)$/gm, '<div class="sticky-h3">$1</div>');
  s = s.replace(/^##\s*(.+)$/gm, '<div class="sticky-h2">$1</div>');
  s = s.replace(/^#\s*(.+)$/gm, '<div class="sticky-h1">$1</div>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function rawRect(node) {
  if (node.type === 'n8n-nodes-base.stickyNote') {
    const w = node.parameters?.width || STICKY_DEFAULT_W;
    const h = node.parameters?.height || STICKY_DEFAULT_H;
    return { x: node.position[0], y: node.position[1], w, h };
  }
  return { x: node.position[0], y: node.position[1], w: NODE_W, h: NODE_H };
}

function rectsOverlap(a, b, shrink = 4) {
  const ax0 = a.x + shrink, ay0 = a.y + shrink, ax1 = a.x + a.w - shrink, ay1 = a.y + a.h - shrink;
  const bx0 = b.x + shrink, by0 = b.y + shrink, bx1 = b.x + b.w - shrink, by1 = b.y + b.h - shrink;
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

function hasNonStickyOverlap(nodes) {
  const real = nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      if (rectsOverlap(rawRect(real[i]), rawRect(real[j]))) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function buildEdges(workflow) {
  const edges = [];
  const conns = workflow.connections || {};
  for (const sourceName of Object.keys(conns)) {
    const sourceConns = conns[sourceName];
    for (const connType of Object.keys(sourceConns)) {
      const outputsArr = sourceConns[connType] || [];
      outputsArr.forEach((targets, outIdx) => {
        (targets || []).forEach((t) => {
          if (!t || !t.node) return;
          edges.push({
            source: sourceName,
            sourceOutputIndex: outIdx,
            target: t.node,
            targetInputIndex: t.index || 0,
            connType,
          });
        });
      });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error('Usage: node scripts/render-n8n-canvas.mjs <workflow.json> <out.png>');
    process.exit(1);
  }

  const workflow = JSON.parse(readFileSync(resolve(inPath), 'utf8'));
  const nodes = workflow.nodes || [];
  if (nodes.length === 0) {
    console.error('Workflow has no nodes.');
    process.exit(1);
  }

  // If tightly-packed node cards would overlap, scale positions (not sizes)
  // up by 1.15x to open breathing room, matching real n8n canvas spacing.
  if (hasNonStickyOverlap(nodes)) {
    for (const n of nodes) {
      n.position = [n.position[0] * 1.15, n.position[1] * 1.15];
    }
  }

  const rects = nodes.map(rawRect);
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));

  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;
  const width = Math.ceil(maxX - minX + PADDING * 2);
  const height = Math.ceil(maxY - minY + PADDING * 2);

  const nodeByName = new Map(nodes.map((n) => [n.name, n]));

  function finalRect(name) {
    const n = nodeByName.get(name);
    if (!n) return null;
    const r = rawRect(n);
    return { x: r.x + offsetX, y: r.y + offsetY, w: r.w, h: r.h };
  }

  const edges = buildEdges(workflow);

  const mainOutCount = {};
  const mainInCount = {};
  for (const e of edges) {
    if (e.connType !== 'main') continue;
    mainOutCount[e.source] = Math.max(mainOutCount[e.source] || 1, e.sourceOutputIndex + 1);
    mainInCount[e.target] = Math.max(mainInCount[e.target] || 1, e.targetInputIndex + 1);
  }

  // -------------------------------------------------------------------------
  // Sticky panels (rendered first -> behind everything)
  // -------------------------------------------------------------------------
  const stickyHtml = nodes
    .filter((n) => n.type === 'n8n-nodes-base.stickyNote')
    .map((n) => {
      const r = finalRect(n.name);
      const content = renderStickyContent(n.parameters?.content || n.name || '');
      return `<div class="sticky" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;">
  <div class="sticky-body">${content}</div>
</div>`;
    })
    .join('\n');

  // -------------------------------------------------------------------------
  // Connector SVG (behind nodes, above stickies)
  // -------------------------------------------------------------------------
  const edgePaths = edges
    .map((e) => {
      const rs = finalRect(e.source);
      const rt = finalRect(e.target);
      if (!rs || !rt) return '';

      if (e.connType === 'main') {
        const outN = mainOutCount[e.source] || 1;
        const inN = mainInCount[e.target] || 1;
        const x1 = rs.x + rs.w;
        const y1 = rs.y + (rs.h * (e.sourceOutputIndex + 1)) / (outN + 1);
        const x2 = rt.x;
        const y2 = rt.y + (rt.h * (e.targetInputIndex + 1)) / (inN + 1);
        const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
        const d = `M ${x1},${y1} C ${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        return `<path d="${d}" class="edge-main" marker-end="url(#arrow)" />`;
      }

      // Sub-connections (ai_languageModel, ai_tool, ai_memory, ...): dashed
      // purple curve from the top of the sub-node up into the bottom of the
      // consuming node, matching n8n's language-model socket convention.
      const x1 = rs.x + rs.w / 2;
      const y1 = rs.y;
      const x2 = rt.x + rt.w / 2;
      const y2 = rt.y + rt.h;
      const dy = Math.max(40, Math.abs(y2 - y1) * 0.5);
      const d = `M ${x1},${y1} C ${x1},${y1 - dy} ${x2},${y2 + dy} ${x2},${y2}`;
      return `<path d="${d}" class="edge-sub" marker-end="url(#arrowPurple)" />`;
    })
    .join('\n');

  // -------------------------------------------------------------------------
  // Node cards (front-most)
  // -------------------------------------------------------------------------
  const nodeHtml = nodes
    .filter((n) => n.type !== 'n8n-nodes-base.stickyNote')
    .map((n) => {
      const r = finalRect(n.name);
      const style = TYPE_STYLE[n.type] || DEFAULT_STYLE;
      const triggerClass = style.trigger ? ' trigger-shape' : '';
      const label = typeLabel(n.type);
      return `<div class="node-card${triggerClass}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;">
  <div class="icon-tile" style="background:${style.color};">${style.glyph}</div>
  <div class="node-text">
    <div class="node-name">${escapeHtml(n.name)}</div>
    <div class="node-sub">${escapeHtml(label)}</div>
  </div>
</div>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    width: ${width}px; height: ${height}px;
    position: relative;
    overflow: hidden;
    background-color: #f7f7f8;
    background-image: radial-gradient(#d9d9de 1.2px, transparent 1.2px);
    background-size: 20px 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .sticky {
    position: absolute;
    z-index: 1;
    background: rgba(255, 248, 196, 0.55);
    border: 1px solid rgba(210, 190, 90, 0.55);
    border-radius: 6px;
    padding: 14px 16px;
    overflow: hidden;
  }
  .sticky-body {
    font-size: 12px;
    line-height: 1.45;
    color: #6b6440;
    white-space: normal;
  }
  .sticky-body .sticky-h1 { font-size: 16px; font-weight: 700; color: #55501f; margin: 0 0 6px; }
  .sticky-body .sticky-h2 { font-size: 15px; font-weight: 700; color: #55501f; margin: 0 0 6px; }
  .sticky-body .sticky-h3 { font-size: 13px; font-weight: 700; color: #5c5626; margin: 6px 0 4px; }
  .sticky-body code {
    background: rgba(0,0,0,0.06);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
  }

  svg.edges {
    position: absolute; top: 0; left: 0;
    width: ${width}px; height: ${height}px;
    z-index: 3;
    pointer-events: none;
  }
  .edge-main {
    fill: none;
    stroke: #b0b3c0;
    stroke-width: 2;
  }
  .edge-sub {
    fill: none;
    stroke: #ea4b71;
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }

  .node-card {
    position: absolute;
    z-index: 5;
    background: #ffffff;
    border: 1px solid #e0e0e5;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
  }
  .node-card.trigger-shape {
    border-radius: 40px 8px 8px 40px;
    padding-left: 16px;
  }
  .icon-tile {
    flex: 0 0 ${ICON_SIZE}px;
    width: ${ICON_SIZE}px;
    height: ${ICON_SIZE}px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #ffffff;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
  }
  .node-text {
    min-width: 0;
    flex: 1 1 auto;
  }
  .node-name {
    font-weight: 600;
    font-size: 13px;
    color: #2d2e3a;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .node-sub {
    font-size: 10.5px;
    color: #9a9ba8;
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
</head>
<body>
${stickyHtml}
<svg class="edges">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#b0b3c0" />
    </marker>
    <marker id="arrowPurple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#ea4b71" />
    </marker>
  </defs>
${edgePaths}
</svg>
${nodeHtml}
</body>
</html>
`;

  const tmpDir = mkdtempSync(join(tmpdir(), 'n8n-canvas-'));
  const tmpHtmlPath = join(tmpDir, 'canvas.html');
  writeFileSync(tmpHtmlPath, html, 'utf8');

  const outAbsPath = resolve(outPath);
  const outDir = dirname(outAbsPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  execFileSync(
    CHROME_BIN,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--force-device-scale-factor=2',
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=2000',
      `--screenshot=${outAbsPath}`,
      `file://${tmpHtmlPath}`,
    ],
    { stdio: 'inherit' },
  );

  console.log(`Wrote ${outAbsPath} (${width}x${height} css px, x2 scale)`);
}

main();
