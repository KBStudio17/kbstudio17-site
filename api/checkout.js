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
      // Every piece is local pickup. Shipping is quoted by email on request and charged separately.
      shipping_options: [pickup],
      custom_text: { submit: { message: 'One-of-a-kind piece. Local pickup in Aurora, Colorado; we will email you to arrange a time. Need it shipped? Email support@kbstudio17.com for a quote before you buy.' } },
    };
    const session = await stripe('/checkout/sessions', params);
    res.status(200).json({ url: session.url });
  } catch (e) { fail(res, e); }
};
