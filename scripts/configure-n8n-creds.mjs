#!/usr/bin/env node
// One-shot: give the local render instance the credential *slots* the workflow
// nodes expect (Ollama base URL, Postgres, webhook JWT secret) so the editor
// canvas renders clean — no "missing credential" warning markers — for the
// README screenshots. Operates on the live n8n DB only; the committed workflow
// JSON stays credential-free (credentials are always instance-local in n8n).
const BASE = process.env.N8N_BASE || 'http://localhost:5678';
const EMAIL = 'demo@example.com';
const PASSWORD = 'Demo-Pass-12345';

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const setc = res.headers.get('set-cookie');
  if (setc) cookie = setc.split(';')[0];
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}

await api('/rest/login', { method: 'POST', body: JSON.stringify({ emailOrLdapLoginId: EMAIL, email: EMAIL, password: PASSWORD }) });
console.log('login ok');

async function makeCred(name, type, data) {
  const r = await api('/rest/credentials', { method: 'POST', body: JSON.stringify({ name, type, data }) });
  const id = (r.data || r).id;
  console.log(`  cred ${name} [${type}] -> ${id}`);
  return { id, name };
}

const ollama = await makeCred('Local Ollama', 'ollamaApi', { baseUrl: 'http://ollama:11434' });
const pg = await makeCred('Decision Postgres', 'postgres', { host: 'postgres', port: 5432, database: 'n8n', user: 'n8n', password: 'n8n', ssl: 'disable' });
const jwt = await makeCred('Webhook JWT', 'jwtAuth', { keyType: 'passphrase', secret: 'demo-signing-secret', algorithm: 'HS256' });

// nodeType -> credential slot to attach
const ATTACH = {
  '@n8n/n8n-nodes-langchain.lmChatOllama': { ollamaApi: ollama },
  'n8n-nodes-base.postgres': { postgres: pg },
  'n8n-nodes-base.webhook': { jwtAuth: jwt },
};

// Newest flagship + framework workflow ids (avoid stale re-imported duplicates).
const all = (await api('/rest/workflows')).data || [];
const newest = (sub) => all.filter((w) => w.name.includes(sub))
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]?.id;
const WF_IDS = [newest('Market-Signal'), newest('Decision Framework')].filter(Boolean);
console.log('target workflows:', WF_IDS.join(', '));
for (const id of WF_IDS) {
  const wf = (await api(`/rest/workflows/${id}`)).data;
  let touched = 0;
  for (const n of wf.nodes) {
    const attach = ATTACH[n.type];
    if (attach) { n.credentials = { ...(n.credentials || {}), ...attach }; touched++; }
  }
  await api(`/rest/workflows/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} }),
  });
  console.log(`workflow ${id}: attached creds to ${touched} nodes`);
}
console.log('done');
