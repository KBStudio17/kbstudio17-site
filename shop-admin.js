// Private Add Piece page. Talks to /api/admin with the passphrase.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var key = '';
  try { key = localStorage.getItem('kb-shop-key') || ''; } catch (e) {}
  var chosen = [];

  function money(c) { return '$' + (c / 100).toFixed(c % 100 ? 2 : 0); }
  function msg(id, text, kind) { var n = $(id); n.textContent = text || ''; n.className = 'admin-msg' + (kind ? ' ' + kind : ''); }

  function api(payload) {
    return fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) { lock(); throw new Error('Wrong passphrase.'); }
        if (!r.ok) throw new Error(d.error || 'Something went wrong.');
        return d;
      });
    });
  }

  function lock() {
    key = '';
    try { localStorage.removeItem('kb-shop-key'); } catch (e) {}
    $('app').hidden = true; $('login').hidden = false;
  }
  function unlock() { $('login').hidden = true; $('app').hidden = false; refresh(); refreshReviews(); }

  // Shrink a phone photo to a web-sized JPEG in the browser before upload.
  function shrink(file) {
    var MAX = 1600;
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); })
      : viaImg(file);
    return load.then(function (img) {
      var scale = Math.min(1, MAX / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
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

  // Photos add up: each pick is appended, so photos can be chosen in several goes.
  function drawPreviews() {
    $('previews').replaceChildren.apply($('previews'), chosen.map(function (u, i) {
      var wrap = document.createElement('span'); wrap.className = 'admin-thumb' + (i === 0 ? ' is-cover' : '');
      var img = new Image(); img.src = u; img.alt = '';
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove photo ' + (i + 1));
      x.addEventListener('click', function () { chosen.splice(i, 1); drawPreviews(); });
      wrap.appendChild(img); wrap.appendChild(x);
      if (i > 0) {
        var c = document.createElement('button'); c.type = 'button'; c.className = 'admin-thumb-cover'; c.textContent = 'Make cover';
        c.addEventListener('click', function () { chosen.unshift(chosen.splice(i, 1)[0]); drawPreviews(); });
        wrap.appendChild(c);
      }
      return wrap;
    }));
  }
  $('photos').addEventListener('change', function () {
    var input = this;
    var files = Array.prototype.slice.call(input.files, 0, Math.max(0, 8 - chosen.length));
    if (!files.length) { if (input.files.length) msg('add-msg', 'A piece can have up to 8 photos.', 'warn'); input.value = ''; return; }
    msg('add-msg', 'Preparing photos…');
    $('publish').disabled = true;
    Promise.all(files.map(shrink)).then(function (urls) {
      chosen = chosen.concat(urls); drawPreviews();
      msg('add-msg', chosen.length + (chosen.length === 1 ? ' photo ready. Tap Photos again to add more.' : ' photos ready.'));
    }).catch(function (e) { msg('add-msg', e.message, 'warn'); })
      .then(function () { $('publish').disabled = false; input.value = ''; });
  });

  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!chosen.length) { msg('add-msg', 'Add at least one photo.', 'warn'); return; }
    var btn = $('publish'); btn.disabled = true;
    var uploaded = [];
    var chain = Promise.resolve();
    chosen.forEach(function (url, i) {
      chain = chain.then(function () {
        msg('add-msg', 'Uploading photo ' + (i + 1) + ' of ' + chosen.length + '…');
        return api({ action: 'photo', data: url.split(',')[1] }).then(function (p) { uploaded.push(p); });
      });
    });
    chain.then(function () {
      msg('add-msg', 'Publishing…');
      return api({ action: 'publish', name: $('name').value, price: $('price').value, description: $('description').value, photos: uploaded });
    }).then(function (d) {
      $('add-form').reset(); chosen = []; $('previews').replaceChildren();
      msg('add-msg', '“' + d.item.name + '” is published. It will show in the shop in about a minute.', 'good');
      refresh();
    }).catch(function (err) { msg('add-msg', err.message, 'warn'); })
      .then(function () { btn.disabled = false; });
  });

  function change(payload, working) {
    msg('list-msg', working);
    return api(payload).then(function () { msg('list-msg', 'Saved. The shop updates in about a minute.', 'good'); return refresh(); })
      .catch(function (e) { msg('list-msg', e.message, 'warn'); });
  }

  function row(item) {
    var sold = item.status === 'sold';
    var div = document.createElement('div'); div.className = 'admin-item' + (sold ? ' is-sold' : '');
    var img = new Image(); img.alt = ''; img.src = item.photos && item.photos[0] ? item.photos[0] : '';
    var info = document.createElement('div');
    var h = document.createElement('strong'); h.textContent = item.name;
    var p = document.createElement('span'); p.textContent = (sold ? 'Sold · ' : 'Available · ') + money(item.price);
    info.appendChild(h); info.appendChild(p);
    var actions = document.createElement('div'); actions.className = 'admin-actions';
    function b(label, fn) { var x = document.createElement('button'); x.type = 'button'; x.className = 'link-button'; x.textContent = label; x.addEventListener('click', fn); actions.appendChild(x); }
    b(sold ? 'Mark available' : 'Mark sold', function () { change({ action: 'update', id: item.id, status: sold ? 'available' : 'sold' }, 'Saving…'); });
    b('Change price', function () {
      var v = window.prompt('New price in dollars for “' + item.name + '”:', (item.price / 100).toString());
      if (v !== null && v.trim()) change({ action: 'update', id: item.id, price: v }, 'Saving…');
    });
    b('Remove', function () {
      if (window.confirm('Remove “' + item.name + '” and its photos from the shop?')) change({ action: 'remove', id: item.id }, 'Removing…');
    });
    var add = document.createElement('input'); add.type = 'file'; add.accept = 'image/*'; add.multiple = true; add.hidden = true;
    add.addEventListener('change', function () {
      var files = Array.prototype.slice.call(add.files, 0, Math.max(0, 8 - item.photos.length));
      add.value = '';
      if (!files.length) { msg('list-msg', 'This piece already has 8 photos.', 'warn'); return; }
      msg('list-msg', 'Preparing photos…');
      var uploaded = [];
      Promise.all(files.map(shrink)).then(function (urls) {
        var chain = Promise.resolve();
        urls.forEach(function (u, i) {
          chain = chain.then(function () {
            msg('list-msg', 'Uploading photo ' + (i + 1) + ' of ' + urls.length + '…');
            return api({ action: 'photo', data: u.split(',')[1] }).then(function (p) { uploaded.push(p); });
          });
        });
        return chain;
      }).then(function () { return change({ action: 'add-photos', id: item.id, photos: uploaded }, 'Saving…'); })
        .catch(function (e) { msg('list-msg', e.message, 'warn'); });
    });
    b('Add photos', function () { add.click(); });
    var strip = document.createElement('div'); strip.className = 'admin-photos';
    (item.photos || []).forEach(function (path, i) {
      var wrap = document.createElement('span'); wrap.className = 'admin-thumb' + (i === 0 ? ' is-cover' : '');
      var t = new Image(); t.src = path; t.alt = ''; wrap.appendChild(t);
      if (item.photos.length > 1) {
        var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove photo ' + (i + 1));
        x.addEventListener('click', function () { if (window.confirm('Remove this photo from “' + item.name + '”?')) change({ action: 'remove-photo', id: item.id, path: path }, 'Removing photo…'); });
        wrap.appendChild(x);
      }
      if (i > 0) {
        var c = document.createElement('button'); c.type = 'button'; c.className = 'admin-thumb-cover'; c.textContent = 'Make cover';
        c.addEventListener('click', function () { change({ action: 'cover-photo', id: item.id, path: path }, 'Saving…'); });
        wrap.appendChild(c);
      }
      strip.appendChild(wrap);
    });
    div.appendChild(img); div.appendChild(info); div.appendChild(strip); div.appendChild(actions); div.appendChild(add);
    return div;
  }

  function refresh() {
    return api({ action: 'list' }).then(function (d) {
      var list = $('list');
      if (!d.items.length) { list.textContent = 'Nothing posted yet.'; return; }
      list.replaceChildren.apply(list, d.items.map(row));
    }).catch(function (e) { if (key) msg('list-msg', e.message, 'warn'); });
  }

  // ---- Reviews ----
  function stars(n) { return '\u2605\u2605\u2605\u2605\u2605'.slice(0, n) + '\u2606\u2606\u2606\u2606\u2606'.slice(0, 5 - n); }
  function revChange(payload, working) {
    msg('rev-msg', working);
    return api(payload).then(function () { msg('rev-msg', 'Saved. The site updates in about a minute.', 'good'); return refreshReviews(); })
      .catch(function (e) { msg('rev-msg', e.message, 'warn'); });
  }
  function reviewCard(r, pending) {
    var div = document.createElement('div'); div.className = 'admin-review';
    function add(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; n.textContent = text; div.appendChild(n); return n; }
    if (r.unreadable) {
      add('p', '', 'This review could not be opened (it was saved before a settings change).');
    } else {
      add('strong', '', r.name + '  ' + stars(r.stars));
      add('p', 'admin-review-text', r.text);
    }
    var photos = document.createElement('div'); photos.className = 'admin-previews'; div.appendChild(photos);
    if (pending && r.photoCount) {
      api({ action: 'review-photos', id: r.id }).then(function (d) {
        d.photos.forEach(function (p) { var i = new Image(); i.alt = ''; i.src = 'data:image/jpeg;base64,' + p; photos.appendChild(i); });
      }).catch(function () {});
    } else if (!pending) {
      (r.photos || []).forEach(function (p) { var i = new Image(); i.alt = ''; i.src = p; photos.appendChild(i); });
    }
    var actions = document.createElement('div'); actions.className = 'admin-actions'; div.appendChild(actions);
    function b(label, cls, fn) { var x = document.createElement('button'); x.type = 'button'; x.className = cls; x.textContent = label; x.addEventListener('click', fn); actions.appendChild(x); }
    if (pending) {
      if (!r.unreadable) b('Approve', 'button primary small-button', function () { revChange({ action: 'review-approve', id: r.id }, 'Publishing review…'); });
      b('Delete', 'link-button', function () { if (window.confirm('Delete this review? It will not be published.')) revChange({ action: 'review-delete', id: r.id }, 'Deleting…'); });
    } else {
      b('Remove from site', 'link-button', function () { if (window.confirm('Remove this published review from the site?')) revChange({ action: 'review-remove', id: r.id }, 'Removing…'); });
    }
    return div;
  }
  function refreshReviews() {
    return api({ action: 'reviews' }).then(function (d) {
      var p = $('rev-pending'), q = $('rev-published');
      if (d.pending.length) p.replaceChildren.apply(p, d.pending.map(function (r) { return reviewCard(r, true); }));
      else p.textContent = 'No reviews waiting.';
      if (d.published.length) q.replaceChildren.apply(q, d.published.map(function (r) { return reviewCard(r, false); }));
      else q.textContent = 'No published reviews yet.';
    }).catch(function (e) { if (key) msg('rev-msg', e.message, 'warn'); });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    key = $('pass').value;
    msg('login-msg', 'Checking…');
    api({ action: 'list' }).then(function () {
      try { localStorage.setItem('kb-shop-key', key); } catch (err) {}
      $('pass').value = ''; msg('login-msg', ''); unlock();
    }).catch(function (err) { msg('login-msg', err.message, 'warn'); });
  });
  $('logout').addEventListener('click', lock);

  if (key) unlock(); else $('login').hidden = false;
})();
