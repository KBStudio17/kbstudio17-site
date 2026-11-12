// Woodworking shop: renders shop/inventory.json into the #shop section.
(function () {
  var root = document.getElementById('shop-grid');
  if (!root) return;
  var notice = document.getElementById('shop-notice');
  var filters = document.getElementById('shop-filters');
  var dialog = document.getElementById('shop-dialog');
  var CONTACT = 'support@kbstudio17.com';
  var items = [];
  var filter = 'all';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function money(c) { return '$' + (c / 100).toFixed(c % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function say(msg, kind) {
    notice.textContent = msg || '';
    notice.className = 'shop-notice' + (msg ? ' show' : '') + (kind ? ' ' + kind : '');
  }
  function requestLink(item) {
    var subject = 'Request: something like "' + item.name + '"';
    var bodyText = 'Hi KB Studio 17,\n\nI saw "' + item.name + '" in the shop and would like something similar.\n\nSize, wood, finish, or other details:\n\n\nName:\n';
    return 'mailto:' + CONTACT + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyText);
  }
  function action(item, big) {
    var cls = 'button ' + (big ? '' : 'small-button ');
    if (item.status === 'sold') {
      return el('a', { class: cls + 'secondary', href: requestLink(item), text: 'Request one like this', onclick: function (e) { e.stopPropagation(); } });
    }
    return el('button', { class: cls + 'primary', type: 'button', text: 'Buy · ' + money(item.price), onclick: function (e) { e.stopPropagation(); buy(item, e.currentTarget); } });
  }

  function buy(item, btn) {
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Opening checkout…';
    fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (r) {
        if (r.data.url) { window.location.href = r.data.url; return; }
        if (r.status === 409) { item.status = 'sold'; if (dialog.open) dialog.close(); render(); }
        throw new Error(r.data.error || 'Checkout could not be started.');
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = label;
        say(e.message + ' You can also email ' + CONTACT + '.', 'warn');
        notice.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
  }

  function open(item) {
    var main = el('img', { class: 'shop-dialog-main', src: item.photos[0] || '', alt: item.name });
    var thumbs = item.photos.length > 1 ? el('div', { class: 'shop-thumbs' }, item.photos.map(function (p, i) {
      return el('button', { type: 'button', 'aria-label': 'Photo ' + (i + 1), onclick: function () { main.src = p; } }, [el('img', { src: p, alt: '' })]);
    })) : null;
    var sold = item.status === 'sold';
    dialog.replaceChildren(
      el('button', { class: 'shop-close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: function () { dialog.close(); } }),
      el('div', { class: 'shop-dialog-body' }, [
        el('div', { class: 'shop-dialog-media' }, [main, thumbs]),
        el('div', { class: 'shop-dialog-copy' }, [
          el('p', { class: 'eyebrow', text: sold ? 'Sold' : 'Available · one of a kind' }),
          el('h2', { text: item.name }),
          el('p', { class: 'shop-price', text: sold ? 'Sold for ' + money(item.price) : money(item.price) }),
          item.description ? el('p', { class: 'shop-desc', text: item.description }) : null,
          el('p', { class: 'small', text: sold
            ? 'This piece has found a home. Every build depends on the material at hand, so a similar piece will be its own original.'
            : (Number.isInteger(item.shipping)
              ? 'Local pickup in Aurora, Colorado, or US shipping for ' + money(item.shipping) + '.'
              : 'Local pickup in Aurora, Colorado.') + ' Secure checkout by Stripe.' }),
          action(item, true)
        ])
      ])
    );
    dialog.showModal();
  }

  function card(item) {
    var sold = item.status === 'sold';
    return el('article', { class: 'shop-card' + (sold ? ' is-sold' : ''), tabindex: '0', role: 'button', 'aria-label': item.name + (sold ? ' (sold)' : ''),
      onclick: function () { open(item); },
      onkeydown: function (e) { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(item); } } }, [
      el('div', { class: 'shop-photo' }, [
        el('img', { src: item.photos[0] || '', alt: item.name, loading: 'lazy' }),
        sold ? el('span', { class: 'shop-badge', text: 'Sold' }) : null
      ]),
      el('div', { class: 'shop-card-copy' }, [
        el('h3', { text: item.name }),
        el('p', { class: 'shop-price', text: sold ? 'Sold for ' + money(item.price) : money(item.price) }),
        action(item, false)
      ])
    ]);
  }

  function render() {
    var avail = items.filter(function (i) { return i.status !== 'sold'; });
    var sold = items.filter(function (i) { return i.status === 'sold'; });
    var list = filter === 'available' ? avail : avail.concat(sold);
    filters.hidden = !sold.length || !avail.length;
    if (!list.length) {
      root.replaceChildren(el('p', { class: 'shop-empty', text: items.length
        ? 'Everything here has sold. Switch to “All work” to see past pieces and request something similar.'
        : 'New pieces are on the bench. Check back soon, or ask about a custom build below.' }));
      return;
    }
    root.replaceChildren.apply(root, list.map(card));
  }

  filters.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-filter]');
    if (!b) return;
    filter = b.getAttribute('data-filter');
    Array.prototype.forEach.call(filters.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    render();
  });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });

  function load() {
    return fetch('shop/inventory.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { items = (d.items || []).filter(function (i) { return i && i.id && i.photos; }); render(); })
      .catch(function () { root.replaceChildren(el('p', { class: 'shop-empty', text: 'The shop could not load. Please refresh the page.' })); });
  }

  // On a device where the owner has unlocked the Shop Manager, show a shortcut to post a piece.
  try {
    if (localStorage.getItem('kb-shop-key')) {
      filters.parentNode.insertBefore(el('p', { class: 'shop-owner' }, [
        el('a', { class: 'button primary', href: 'shop-admin.html', text: '+ Add a piece' }),
        el('span', { text: 'Only you see this button.' })
      ]), filters);
    }
  } catch (e) {}

  var paid = new URLSearchParams(location.search).get('paid');
  load().then(function () {
    if (!paid) return;
    say('Thank you! Your payment went through. We will email you shortly to arrange pickup or shipping.', 'good');
    history.replaceState(null, '', location.pathname + '#shop');
    fetch('/api/confirm?session_id=' + encodeURIComponent(paid))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        // The site rebuilds about a minute after a sale; show it as sold right away for this visitor.
        items.forEach(function (i) { if (i.id === d.id) i.status = 'sold'; });
        render();
      }).catch(function () {});
  });
})();
