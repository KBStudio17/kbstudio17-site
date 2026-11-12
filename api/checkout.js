// POST { id } -> { url } : starts a Stripe Checkout for one piece.
const { readInventory, stripe, body, fail } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const { id } = body(req);
    // Read live from GitHub (not the deployed copy) so a piece that just sold can't sell twice.
    const inv = await readInventory();
    const item = inv.items.find((i) => i.id === id);
    if (!item) return res.status(404).json({ error: 'That piece could not be found.' });
    if (item.status !== 'available') return res.status(409).json({ error: 'This piece just sold.' });

    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const ships = Number.isInteger(item.shipping) && item.shipping >= 0;
    const pickup = {
      shipping_rate_data: { type: 'fixed_amount', display_name: 'Local pickup (Aurora, Colorado)', fixed_amount: { amount: 0, currency: 'usd' } },
    };
    const params = {
      mode: 'payment',
      success_url: `${origin}/woodworking.html?paid={CHECKOUT_SESSION_ID}#shop`,
      cancel_url: `${origin}/woodworking.html#shop`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      metadata: { item_id: item.id },
      payment_intent_data: { description: `KB Studio 17 woodworking: ${item.name}`, metadata: { item_id: item.id } },
      phone_number_collection: { enabled: true },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: item.price,
          product_data: {
            name: item.name,
            ...(item.description ? { description: item.description.slice(0, 400) } : {}),
            ...(item.photos && item.photos[0] ? { images: [`${origin}/${item.photos[0]}`] } : {}),
          },
        },
      }],
      shipping_options: ships
        ? [pickup, { shipping_rate_data: { type: 'fixed_amount', display_name: 'Shipping (US)', fixed_amount: { amount: item.shipping, currency: 'usd' } } }]
        : [pickup],
      ...(ships ? { shipping_address_collection: { allowed_countries: ['US'] } } : {}),
      custom_text: { submit: { message: ships
        ? 'One-of-a-kind piece. Choose local pickup in Aurora, Colorado or shipping. We will email you to arrange it.'
        : 'One-of-a-kind piece. Local pickup in Aurora, Colorado. We will email you to arrange a time.' } },
    };
    const session = await stripe('/checkout/sessions', params);
    res.status(200).json({ url: session.url });
  } catch (e) { fail(res, e); }
};
