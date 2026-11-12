// Shared helpers for the woodworking shop. Not a route (underscore prefix).
// Inventory lives in the repo at shop/inventory.json; every change is a git commit,
// so any change can be undone from GitHub's history.
const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'KBStudio17/kbstudio17-site';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';
const STRIPE_API = process.env.STRIPE_API_URL || 'https://api.stripe.com';
const INVENTORY_PATH = 'shop/inventory.json';

function need(name) {
  const v = process.env[name];
  if (!v) {
    const e = new Error(`The shop is not fully set up yet (${name} is missing in Vercel).`);
    e.status = 500;
    throw e;
  }
  return v;
}

async function gh(path, opts = {}) {
  const r = await fetch(`${GITHUB_API}/repos/${REPO}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${need('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kbstudio17-shop',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!r.ok) {
    const e = new Error(`GitHub ${r.status}: ${data.message || 'request failed'}`);
    e.status = 502;
    e.githubStatus = r.status;
    throw e;
  }
  return data;
}

async function headSha() {
  const ref = await gh(`/git/ref/heads/${BRANCH}`);
  return ref.object.sha;
}

async function readInventory(ref) {
  try {
    const f = await gh(`/contents/${INVENTORY_PATH}?ref=${ref || BRANCH}`);
    const inv = JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
    if (!Array.isArray(inv.items)) inv.items = [];
    return inv;
  } catch (e) {
    if (e.githubStatus === 404) return { items: [] };
    throw e;
  }
}

// Read the inventory at the branch head, apply `mutate`, and commit the result
// (plus any photo blobs / deletions) as ONE commit. Retries if the branch moved.
async function updateInventory(mutate, message) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = await headSha();
    const inv = await readInventory(parent);
    const extra = (await mutate(inv)) || {};
    if (extra.skip) return inv;
    const parentCommit = await gh(`/git/commits/${parent}`);
    const tree = [
      { path: INVENTORY_PATH, mode: '100644', type: 'blob', content: JSON.stringify(inv, null, 2) + '\n' },
      ...(extra.add || []).map((p) => ({ path: p.path, mode: '100644', type: 'blob', sha: p.sha })),
      ...(extra.remove || []).map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
    ];
    try {
      const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: parentCommit.tree.sha, tree } });
      const commit = await gh('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [parent] } });
      await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha } });
      return inv;
    } catch (e) {
      lastErr = e;
      if (e.githubStatus !== 422 && e.githubStatus !== 409) throw e;
    }
  }
  throw lastErr;
}

function formEncode(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(path, params) {
  const r = await fetch(`${STRIPE_API}/v1${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${need('STRIPE_SECRET_KEY')}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? formEncode(params).toString() : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Stripe: ${(data.error && data.error.message) || r.status}`);
    e.status = 502;
    throw e;
  }
  return data;
}

// Never trusts the caller: looks the session up at Stripe and only marks the
// piece sold if Stripe says it was paid.
async function markSoldFromSession(sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) return { ok: false, reason: 'bad session' };
  const session = await stripe(`/checkout/sessions/${sessionId}`);
  const itemId = session.metadata && session.metadata.item_id;
  if (session.payment_status !== 'paid' || !itemId) return { ok: false, reason: 'not paid' };
  let name = '';
  await updateInventory((inv) => {
    const item = inv.items.find((i) => i.id === itemId);
    if (!item) return { skip: true };
    name = item.name;
    if (item.status === 'sold') return { skip: true };
    item.status = 'sold';
    item.soldAt = new Date().toISOString();
    item.soldSession = sessionId;
  }, `Shop: sold "${itemId}"`);
  return { ok: true, itemId, name };
}

function checkAdmin(req) {
  const expected = need('ADMIN_PASSWORD');
  const given = String(req.headers['x-admin-key'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function fail(res, e) {
  console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' });
}

module.exports = { gh, readInventory, updateInventory, stripe, markSoldFromSession, checkAdmin, body, fail, crypto };
