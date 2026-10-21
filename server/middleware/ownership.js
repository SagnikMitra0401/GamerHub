const mongoose = require('mongoose');
const { isAppStaff } = require('../utils/permissions');
const { badRequest, forbidden, notFound } = require('../utils/httpError');

/**
 * Generic factory: allows the resource owner, or application staff
 * (`admin` / `moderator`) for platform-wide moderation.
 *
 * Note: server (community) roles do NOT grant power here — they only apply
 * inside their own server.
 */
const checkOwnership = (Model, ownerField = 'userId') => async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw badRequest('Invalid resource id');
    }

    const doc = await Model.findById(id);
    if (!doc) throw notFound('Resource not found');

    const ownerId = doc[ownerField];
    const isOwner = ownerId && ownerId.toString() === req.user._id.toString();

    if (!isOwner && !isAppStaff(req.user)) {
      throw forbidden('Forbidden: not resource owner');
    }

    req.resource = doc;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { checkOwnership };
