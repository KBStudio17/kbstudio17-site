// Stripe webhook: marks a piece sold even if the buyer closes the tab before returning.
// The payload is treated only as a hint; the session is re-fetched from Stripe before anything changes.
const { markSoldFromSession, body, fail } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const event = body(req);
    const paidTypes = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
    if (paidTypes.includes(event.type) && event.data && event.data.object) {
      await markSoldFromSession(event.data.object.id);
    }
    res.status(200).json({ received: true });
  } catch (e) { fail(res, e); }
};
