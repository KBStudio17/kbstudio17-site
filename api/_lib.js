// Shared helpers for the woodworking shop. Not a route (underscore prefix).
// Inventory lives in the repo at shop/inventory.json; every change is a git commit,
// so any change can be undone from GitHub's history.
const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'KBStudio17/kbstudio17-site';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';
const STRIPE_API = process.env.STRIPE_API_URL || 'https://api.stripe.com';
const INVENTORY_PATH = 'shop/inventory.json';
const REVIEWS_PATH = 'shop/reviews.json';
const PENDING_DIR = 'shop/reviews-pending';

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

async function readJson(path, fallback, ref) {
  try {
    const f = await gh(`/contents/${path}?ref=${ref || BRANCH}`);
    const data = JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
    for (const k of Object.keys(fallback)) if (!Array.isArray(data[k])) data[k] = [];
    return data;
  } catch (e) {
    if (e.githubStatus === 404) return JSON.parse(JSON.stringify(fallback));
    throw e;
  }
}
const readInventory = (ref) => readJson(INVENTORY_PATH, { items: [] }, ref);

// Read a JSON file at the branch head, apply `mutate`, and commit the result
// (plus any added blobs / deletions) as ONE commit. Retries if the branch moved.
async function updateJson(path, fallback, mutate, message) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = await headSha();
    const data = await readJson(path, fallback, parent);
    const extra = (await mutate(data)) || {};
    if (extra.skip) return data;
    const parentCommit = await gh(`/git/commits/${parent}`);
    const tree = [
      { path, mode: '100644', type: 'blob', content: JSON.stringify(data, null, 2) + '\n' },
      ...(extra.add || []).map((p) => ({ path: p.path, mode: '100644', type: 'blob', sha: p.sha })),
      ...(extra.remove || []).map((rm) => ({ path: rm, mode: '100644', type: 'blob', sha: null })),
    ];
    try {
      const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: parentCommit.tree.sha, tree } });
      const commit = await gh('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [parent] } });
      await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha } });
      return data;
    } catch (e) {
      lastErr = e;
      if (e.githubStatus !== 422 && e.githubStatus !== 409) throw e;
    }
  }
  throw lastErr;
}

const updateInventory = (mutate, message) => updateJson(INVENTORY_PATH, { items: [] }, mutate, message);
const readReviews = () => readJson(REVIEWS_PATH, { reviews: [] });
const updateReviews = (mutate, message) => updateJson(REVIEWS_PATH, { reviews: [] }, mutate, message);

// Commit file additions / deletions without touching a JSON file.
async function commitFiles({ add = [], remove = [] }, message) {
  const parent = await headSha();
  const parentCommit = await gh(`/git/commits/${parent}`);
  const tree = [
    ...add.map((p) => ({ path: p.path, mode: '100644', type: 'blob', sha: p.sha })),
    ...remove.map((rm) => ({ path: rm, mode: '100644', type: 'blob', sha: null })),
  ];
  const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: parentCommit.tree.sha, tree } });
  const commit = await gh('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [parent] } });
  await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha } });
}

async function listDir(dir) {
  try {
    const list = await gh(`/contents/${dir}?ref=${BRANCH}`);
    return Array.isArray(list) ? list.filter((f) => f.type === 'file') : [];
  } catch (e) {
    if (e.githubStatus === 404) return [];
    throw e;
  }
}

async function createBlob(base64) {
  const blob = await gh('/git/blobs', { method: 'POST', body: { content: base64, encoding: 'base64' } });
  return blob.sha;
}

async function readBlob(sha) {
  const blob = await gh(`/git/blobs/${sha}`);
  return Buffer.from(blob.content, 'base64');
}

// Reviews awaiting approval are stored encrypted, because the repository is public.
// The key comes from a server-side secret, so nobody browsing GitHub can read them.
function sealKey() {
  return crypto.createHash('sha256').update('kb-shop-reviews:' + need('GITHUB_TOKEN')).digest();
}
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
function unseal(buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
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

module.exports = {
  gh, readInventory, updateInventory, updateReviews, readReviews, commitFiles, listDir, createBlob, readBlob, seal, unseal,
  stripe, markSoldFromSession, checkAdmin, body, fail, crypto, PENDING_DIR,
};
