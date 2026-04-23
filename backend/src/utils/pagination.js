/**
 * Safely parse pagination query params.
 *
 * Prevents abuse like ?limit=999999 or ?limit=-1 by clamping to [1, maxLimit].
 * Returns { limit, before } ready to pass to DB helpers.
 *
 * @param {object} query       - req.query
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit=50]
 * @param {number} [opts.maxLimit=100]
 * @returns {{ limit: number, before: number|null }}
 */
function parsePagination(query, { defaultLimit = 50, maxLimit = 100 } = {}) {
  const raw = parseInt(query.limit, 10);
  const limit = Number.isFinite(raw)
    ? Math.min(Math.max(1, raw), maxLimit)
    : defaultLimit;

  const rawBefore = parseInt(query.before, 10);
  const before = Number.isFinite(rawBefore) && rawBefore > 0 ? rawBefore : null;

  return { limit, before };
}

module.exports = { parsePagination };
