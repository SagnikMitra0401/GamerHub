const { getCatalog, searchGames, distinctGenres, getGameDetail, MAX_RESULTS } = require('../utils/gameCatalog');
const { UpstreamError } = require('../utils/outbound');
const { notFound, badRequest } = require('../utils/httpError');

// GET /api/games?q=&genre=&platform=&limit=
const getGames = async (req, res, next) => {
  try {
    const { games, fetchedAt, stale } = await getCatalog();

    const limit = Math.min(Math.max(Number(req.query.limit) || MAX_RESULTS, 1), MAX_RESULTS);
    const results = searchGames(games, {
      q: req.query.q,
      genre: req.query.genre,
      platform: req.query.platform,
      limit
    });

    res.status(200).json({
      games: results,
      total: results.length,
      catalogSize: games.length,
      genres: distinctGenres(games),
      platforms: [...new Set(games.map((g) => g.platform).filter(Boolean))].sort(),
      stale: !!stale,
      fetchedAt
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return res.status(503).json({ message: 'The game catalog is temporarily unavailable. Try again shortly.' });
    }
    next(err);
  }
};

// GET /api/games/:id
const getGameById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid game id');

    let game = null;
    try {
      game = await getGameDetail(id);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return res.status(503).json({ message: 'Game details are temporarily unavailable.' });
      }
      throw err;
    }

    if (!game) throw notFound('Game not found');
    res.status(200).json(game);
  } catch (err) {
    next(err);
  }
};

module.exports = { getGames, getGameById };
