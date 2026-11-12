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
  function unlock() { $('login').hidden = true; $('app').hidden = false; refresh(); }

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

  $('photos').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files, 0, 8);
    msg('add-msg', files.length ? 'Preparing photos…' : '');
    $('publish').disabled = true;
    Promise.all(files.map(shrink)).then(function (urls) {
      chosen = urls;
      $('previews').replaceChildren.apply($('previews'), urls.map(function (u) { var i = new Image(); i.src = u; i.alt = ''; return i; }));
      msg('add-msg', '');
    }).catch(function (e) { chosen = []; $('previews').replaceChildren(); msg('add-msg', e.message, 'warn'); })
      .then(function () { $('publish').disabled = false; });
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
      return api({ action: 'publish', name: $('name').value, price: $('price').value, shipping: $('shipping').value, description: $('description').value, photos: uploaded });
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
    var p = document.createElement('span'); p.textContent = (sold ? 'Sold · ' : 'Available · ') + money(item.price) + (Number.isInteger(item.shipping) ? ' · ships ' + money(item.shipping) : ' · pickup only');
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
    div.appendChild(img); div.appendChild(info); div.appendChild(actions);
    return div;
  }

  function refresh() {
    return api({ action: 'list' }).then(function (d) {
      var list = $('list');
      if (!d.items.length) { list.textContent = 'Nothing posted yet.'; return; }
      list.replaceChildren.apply(list, d.items.map(row));
    }).catch(function (e) { if (key) msg('list-msg', e.message, 'warn'); });
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
