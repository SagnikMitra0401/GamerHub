const { listGames, getRails, getGameDetail, toggleFollowGame } = require('../services/gameService');
const { badRequest, notFound } = require('../utils/httpError');
const { UpstreamError } = require('../utils/outbound');
const { sanitizeLine } = require('../utils/sanitize');

// GET /api/games?q=&genre=&platform=&sort=&cursor=&limit=
const getGames = async (req, res, next) => {
  try {
    const payload = await listGames({
      q: sanitizeLine(req.query.q, 60),
      genre: sanitizeLine(req.query.genre, 40),
      platform: sanitizeLine(req.query.platform, 40),
      sort: sanitizeLine(req.query.sort, 20),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor.slice(0, 400) : null,
      limit: req.query.limit,
    });
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.status(200).json(payload);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return res
        .status(503)
        .json({ message: 'The game catalog is temporarily unavailable. Try again shortly.' });
    }
    next(err);
  }
};

// GET /api/games/rails — signed-out callers get the three public rails.
const getGameRails = async (req, res, next) => {
  try {
    const payload = await getRails(req.user || null);
    res.set(
      'Cache-Control',
      req.user ? 'private, no-store' : 'public, max-age=60, stale-while-revalidate=300',
    );
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

// GET /api/games/:slug — also accepts a legacy numeric FreeToGame id.
const getGame = async (req, res, next) => {
  try {
    const game = await getGameDetail(req.params.slug);
    if (!game) throw notFound('Game not found');

    let following = false;
    if (req.user) {
      const titles = req.user.preferences?.favoriteGames || [];
      following = titles.some(
        (title) => String(title).trim().toLowerCase() === game.title.trim().toLowerCase(),
      );
    }

    res.set('Cache-Control', req.user ? 'private, no-store' : 'public, max-age=60');
    res.status(200).json({ ...game, following });
  } catch (err) {
    next(err);
  }
};

// POST /api/games/:slug/follow
const followGame = async (req, res, next) => {
  try {
    const result = await toggleFollowGame(req.user._id, req.params.slug);
    if (!result) throw notFound('Game not found');
    if (result.limitReached) {
      throw badRequest('You can follow up to 20 games. Remove one first.');
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

module.exports = { getGames, getGameRails, getGame, followGame };
