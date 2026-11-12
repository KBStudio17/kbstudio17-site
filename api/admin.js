// POST { action, ... } with header x-admin-key. Powers the private Add Piece page.
const { gh, readInventory, updateInventory, checkAdmin, body, fail, crypto } = require('./_lib');

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function cents(v, { allowBlank = false, min = 0 } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (allowBlank) return null;
    throw bad('Enter a price.');
  }
  const n = Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100);
  if (!Number.isFinite(n) || n < min) throw bad('That dollar amount does not look right.');
  return n;
}

const clean = (s, max) => String(s || '').trim().slice(0, max);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Wrong passphrase.' });
    const b = body(req);

    if (b.action === 'list') {
      return res.status(200).json(await readInventory());
    }

    // One photo per request keeps each upload small. Returns a blob to attach at publish.
    if (b.action === 'photo') {
      const data = String(b.data || '');
      if (!data || data.length > 5_500_000) throw bad('That photo is too large.');
      const blob = await gh('/git/blobs', { method: 'POST', body: { content: data, encoding: 'base64' } });
      return res.status(200).json({ sha: blob.sha, path: `shop/photos/${crypto.randomBytes(8).toString('hex')}.jpg` });
    }

    if (b.action === 'publish') {
      const name = clean(b.name, 80);
      if (!name) throw bad('Give the piece a name.');
      const price = cents(b.price, { min: 50 });
      const shipping = cents(b.shipping, { allowBlank: true });
      const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 8)
        .filter((p) => /^[0-9a-f]{40,64}$/.test(p.sha || '') && /^shop\/photos\/[0-9a-f]{16}\.jpg$/.test(p.path || ''));
      if (!photos.length) throw bad('Add at least one photo.');
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'piece';
      const item = {
        id: `${slug}-${crypto.randomBytes(3).toString('hex')}`,
        name, price, shipping,
        description: clean(b.description, 1200),
        photos: photos.map((p) => p.path),
        status: 'available',
        createdAt: new Date().toISOString(),
      };
      await updateInventory((inv) => { inv.items.unshift(item); return { add: photos }; }, `Shop: add "${name}"`);
      return res.status(200).json({ ok: true, item });
    }

    if (b.action === 'update') {
      let updated;
      await updateInventory((inv) => {
        const item = inv.items.find((i) => i.id === b.id);
        if (!item) throw bad('That piece could not be found.');
        if (b.name !== undefined) { item.name = clean(b.name, 80) || item.name; }
        if (b.description !== undefined) item.description = clean(b.description, 1200);
        if (b.price !== undefined) item.price = cents(b.price, { min: 50 });
        if (b.shipping !== undefined) item.shipping = cents(b.shipping, { allowBlank: true });
        if (b.status === 'sold' && item.status !== 'sold') { item.status = 'sold'; item.soldAt = new Date().toISOString(); }
        if (b.status === 'available') { item.status = 'available'; delete item.soldAt; delete item.soldSession; }
        updated = item;
      }, `Shop: update "${b.id}"`);
      return res.status(200).json({ ok: true, item: updated });
    }

    if (b.action === 'remove') {
      await updateInventory((inv) => {
        const i = inv.items.findIndex((x) => x.id === b.id);
        if (i < 0) throw bad('That piece could not be found.');
        const [gone] = inv.items.splice(i, 1);
        return { remove: gone.photos || [] };
      }, `Shop: remove "${b.id}"`);
      return res.status(200).json({ ok: true });
    }

    throw bad('Unknown action.');
  } catch (e) { fail(res, e); }
};
