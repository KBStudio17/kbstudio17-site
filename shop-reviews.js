// Reviews on the woodworking page: shows approved reviews and takes new ones.
(function () {
  var list = document.getElementById('reviews-list');
  if (!list) return;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('review-dialog'), form = $('review-form'), viewer = $('photo-view');
  var photos = [];

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function msg(text, kind) { var n = $('rv-msg'); n.textContent = text || ''; n.className = 'admin-msg' + (kind ? ' ' + kind : ''); }

  function card(r) {
    var c = el('article', 'review-card');
    var s = el('p', 'stars', stars(r.stars)); s.setAttribute('aria-label', r.stars + ' out of 5 stars'); c.appendChild(s);
    c.appendChild(el('p', 'review-text', r.text));
    if (r.photos && r.photos.length) {
      var wrap = el('div', 'review-photos');
      r.photos.forEach(function (p) {
        var b = el('button'); b.type = 'button'; b.setAttribute('aria-label', 'View photo from ' + r.name);
        var i = new Image(); i.src = p; i.alt = ''; i.loading = 'lazy'; b.appendChild(i);
        b.addEventListener('click', function () { viewer.querySelector('img').src = p; viewer.showModal(); });
        wrap.appendChild(b);
      });
      c.appendChild(wrap);
    }
    var when = r.createdAt ? new Date(r.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : '';
    c.appendChild(el('p', 'review-name', r.name + (when ? ' · ' + when : '')));
    return c;
  }

  function render(reviews) {
    var sum = $('reviews-summary');
    if (!reviews.length) {
      sum.textContent = '';
      list.replaceChildren(el('p', 'reviews-empty', 'No reviews yet. If you own a piece, be the first to leave one.'));
      return;
    }
    var avg = reviews.reduce(function (a, r) { return a + r.stars; }, 0) / reviews.length;
    sum.replaceChildren(el('span', 'stars', stars(Math.round(avg))), document.createTextNode(' ' + avg.toFixed(1) + ' from ' + reviews.length + (reviews.length === 1 ? ' review' : ' reviews')));
    list.replaceChildren.apply(list, reviews.map(card));
  }

  fetch('shop/reviews.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { render((d.reviews || []).filter(function (r) { return r && r.name && r.stars; })); })
    .catch(function () { render([]); });

  viewer.addEventListener('click', function () { viewer.close(); });
  $('review-open').addEventListener('click', function () { msg(''); dialog.showModal(); });
  $('review-close').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });

  // Shrink a phone photo in the browser so uploads stay small.
  function shrink(file) {
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); })
      : viaImg(file);
    return load.then(function (img) {
      var scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var q = 0.82, url = c.toDataURL('image/jpeg', q);
      while (url.length > 850000 && q > 0.4) { q -= 0.12; url = c.toDataURL('image/jpeg', q); }
      return url;
    });
  }
  function viaImg(file) {
    return new Promise(function (ok, no) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { no(new Error('“' + file.name + '” could not be read. Try a JPG or PNG.')); };
      img.src = URL.createObjectURL(file);
    });
  }

  $('rv-photos').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files, 0, 3);
    $('rv-submit').disabled = true; msg(files.length ? 'Preparing photos…' : '');
    Promise.all(files.map(shrink)).then(function (urls) {
      photos = urls;
      $('rv-previews').replaceChildren.apply($('rv-previews'), urls.map(function (u) { var i = new Image(); i.src = u; i.alt = ''; return i; }));
      msg('');
    }).catch(function (e) { photos = []; $('rv-previews').replaceChildren(); msg(e.message, 'warn'); })
      .then(function () { $('rv-submit').disabled = false; });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var picked = form.querySelector('input[name="rv-stars"]:checked');
    var name = $('rv-name').value.trim(), text = $('rv-text').value.trim();
    if (!name) { msg('Please add your name.', 'warn'); return; }
    if (!picked) { msg('Please choose a star rating.', 'warn'); return; }
    if (text.length < 5) { msg('Please write a few words for your review.', 'warn'); return; }
    var btn = $('rv-submit'); btn.disabled = true; msg('Sending…');
    fetch('/api/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, stars: Number(picked.value), text: text, website: $('rv-website').value,
        photos: photos.map(function (u) { return u.split(',')[1]; }) })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.'); }); })
      .then(function () {
        form.reset(); photos = []; $('rv-previews').replaceChildren();
        msg('Thank you! Your review will appear here once it has been approved.', 'good');
      })
      .catch(function (err) { msg(err.message, 'warn'); })
      .then(function () { btn.disabled = false; });
  });
})();
