// GET /piece/<id> : the shareable link for one piece.
// Link previews (texts, social posts) read the piece's own photo, name and price from here;
// people are sent straight on to the shop with that piece open.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);

module.exports = async (req, res) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${host}`;
  const id = String(req.query.id || '');
  const shop = `${origin}/woodworking.html#shop`;
  let item = null;
  try {
    if (/^[a-z0-9-]{1,60}$/.test(id)) {
      const r = await fetch(`${origin}/shop/inventory.json`);
      if (r.ok) item = ((await r.json()).items || []).find((i) => i.id === id) || null;
    }
  } catch (e) { item = null; }

  if (!item) {
    res.statusCode = 302;
    res.setHeader('Location', shop);
    return res.end();
  }

  const sold = item.status === 'sold';
  const target = `${origin}/woodworking.html#piece-${item.id}`;
  const title = `${item.name} | KB Studio 17 Woodworking`;
  const blurb = String(item.description || '').replace(/\s+/g, ' ').trim();
  const desc = (sold ? 'Sold. ' : `${money(item.price)}. One of a kind. `) + (blurb.length > 150 ? blurb.slice(0, 147) + '…' : blurb);
  const image = item.photos && item.photos[0] ? `${origin}/${item.photos[0]}` : `${origin}/shop/og-image.png`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/><meta property="og:site_name" content="KB Studio 17"/>
<meta property="og:title" content="${esc(title)}"/><meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(`${origin}/piece/${item.id}`)}"/><meta property="og:image" content="${esc(image)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta http-equiv="refresh" content="0; url=${esc(target)}"/><link rel="canonical" href="${esc(target)}"/>
<script>location.replace(${JSON.stringify(target)});</script>
</head><body style="background:#070706;color:#f4efe4;font-family:sans-serif;padding:40px"><p><a style="color:#e0b56b" href="${esc(target)}">${esc(item.name)} at KB Studio 17 Woodworking</a></p></body></html>`);
};
