/* Home page: show up to three recent pieces from the shop inventory. */
(function () {
  var box = document.getElementById('home-shop'), wrap = document.getElementById('latest');
  if (!box || !wrap) return;
  function money(c) { return '$' + (c / 100).toFixed(c % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  fetch('shop/inventory.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (data) {
    var items = (data.items || []).filter(function (i) { return i.photos && i.photos.length; });
    items.sort(function (a, b) {
      var av = a.status === 'available' ? 0 : 1, bv = b.status === 'available' ? 0 : 1;
      return av - bv || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    items = items.slice(0, 3);
    if (!items.length) return;
    items.forEach(function (i) {
      var a = document.createElement('a'), img = document.createElement('img'), d = document.createElement('div'),
          s = document.createElement('strong'), p = document.createElement('span');
      a.className = 'home-piece'; a.href = 'woodworking.html#piece-' + encodeURIComponent(i.id);
      img.src = i.photos[0]; img.alt = i.name; img.loading = 'lazy';
      s.textContent = i.name; p.textContent = i.status === 'available' ? money(i.price) : 'Sold';
      d.appendChild(s); d.appendChild(p); a.appendChild(img); a.appendChild(d); box.appendChild(a);
    });
    wrap.hidden = false;
  }).catch(function () {});
})();
