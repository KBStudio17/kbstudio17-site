// GET ?session_id=cs_... : called when a buyer lands back on the site after paying.
const { markSoldFromSession, fail } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const result = await markSoldFromSession(req.query.session_id);
    res.status(200).json({ ok: result.ok, id: result.itemId || '' });
  } catch (e) { fail(res, e); }
};
