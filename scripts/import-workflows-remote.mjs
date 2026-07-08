#!/usr/bin/env node
// Deploy the version-controlled workflows/*.json into a *running* n8n instance
// (local or the live Cloud Run one) over its API — the programmatic, repeatable
// alternative to hand-importing in the UI. Idempotent: updates a workflow if one
// with the same name already exists, otherwise creates it.
//
// Auth, in order of preference:
//   1. N8N_API_KEY  -> n8n public API (X-N8N-API-KEY). Create one in
//      Settings -> n8n API; this is the CD-grade path (store it in Secret Manager).
//   2. N8N_EMAIL + N8N_PASSWORD -> internal /rest login (owner account).
//
// Usage:
//   N8N_BASE=https://f1-n8n-xxxx.a.run.app N8N_API_KEY=... node scripts/import-workflows-remote.mjs
//   N8N_BASE=http://localhost:5678 N8N_EMAIL=... N8N_PASSWORD=... node scripts/import-workflows-remote.mjs
import { readFileSync, readdirSync } from 'node:fs';

const BASE = (process.env.N8N_BASE || 'http://localhost:5678').replace(/\/$/, '');
const API_KEY = process.env.N8N_API_KEY;
const EMAIL = process.env.N8N_EMAIL;
const PASSWORD = process.env.N8N_PASSWORD;
const DIR = 'workflows';

let cookie = '';
function authHeaders() {
  if (API_KEY) return { 'X-N8N-API-KEY': API_KEY };
  return cookie ? { Cookie: cookie } : {};
}
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, json, text };
}

// public API uses /api/v1/*, internal login uses /rest/*
const usePublic = Boolean(API_KEY);
const WF = usePublic ? '/api/v1/workflows' : '/rest/workflows';

if (!usePublic) {
  if (!EMAIL || !PASSWORD) {
    console.error('Set N8N_API_KEY, or N8N_EMAIL + N8N_PASSWORD.');
    process.exit(1);
  }
  const r = await call('/rest/login', { method: 'POST', body: JSON.stringify({ emailOrLdapLoginId: EMAIL, email: EMAIL, password: PASSWORD }) });
  if (!r.ok) { console.error('login failed:', r.status, r.text.slice(0, 200)); process.exit(1); }
  console.log(`logged in to ${BASE}`);
}

// existing workflows -> name:id map (for idempotent update)
const list = (await call(WF + '?limit=200')).json;
const existing = new Map(((list?.data || list) || []).map((w) => [w.name, w.id]));

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
for (const f of files) {
  const w = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  // n8n's create/update API accepts exactly these fields:
  const payload = { name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} };
  const id = existing.get(w.name);
  const r = id
    ? await call(`${WF}/${id}`, { method: usePublic ? 'PUT' : 'PATCH', body: JSON.stringify(payload) })
    : await call(WF, { method: 'POST', body: JSON.stringify(payload) });
  const verb = id ? 'updated' : 'created';
  console.log(r.ok ? `${verb}: ${w.name}` : `FAILED ${f}: ${r.status} ${r.text.slice(0, 160)}`);
}
console.log('done');
