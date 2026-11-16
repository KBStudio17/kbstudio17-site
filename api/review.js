// POST { name, stars, text, photos[] } : a visitor leaves a review.
// Nothing is shown publicly until it is approved in the Shop Manager. Until then the
// review is stored encrypted, because this repository is public.
const { commitFiles, listDir, createBlob, seal, body, fail, crypto, PENDING_DIR } = require('./_lib');

const MAX_PENDING = 25;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const b = body(req);
    // Hidden field real visitors never see; bots that fill it get a quiet "thanks".
    if (b.website) return res.status(200).json({ ok: true });

    const name = String(b.name || '').trim().slice(0, 60);
    const text = String(b.text || '').trim().slice(0, 1500);
    const stars = Number(b.stars);
    if (!name) throw bad('Please add your name.');
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('Please choose a star rating.');
    if (text.length < 5) throw bad('Please write a few words for your review.');
    const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 3).map(String);
    for (const p of photos) {
      if (p.length > 900000 || !/^\/9j\/[A-Za-z0-9+/=]+$/.test(p)) throw bad('One of the photos could not be read. Try a different one.');
    }

    if ((await listDir(PENDING_DIR)).length >= MAX_PENDING) {
      return res.status(429).json({ error: 'We are catching up on reviews right now. Please try again in a day or two.' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const sealed = seal({ id, name, stars, text, photos, createdAt: new Date().toISOString() });
    const sha = await createBlob(sealed.toString('base64'));
    await commitFiles({ add: [{ path: `${PENDING_DIR}/${id}.enc`, sha }] }, 'Shop: review received');
    res.status(200).json({ ok: true });
  } catch (e) { fail(res, e); }
};
