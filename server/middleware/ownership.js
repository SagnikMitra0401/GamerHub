const mongoose = require('mongoose');

// Generic factory: checks req.user._id === document[ownerField]
// Moderators and admins can bypass this check for content moderation (SRS §5.5)
const checkOwnership = (Model, ownerField = 'userId') => async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid resource id' });
  }

  const doc = await Model.findById(id);

  if (!doc) {
    return res.status(404).json({ message: 'Resource not found' });
  }

  // Admins and moderators can act on any content
  const isMod = req.user.role === 'admin' || req.user.role === 'moderator';
  const isOwner = doc[ownerField].toString() === req.user._id.toString();

  if (!isMod && !isOwner) {
    return res.status(403).json({ message: 'Forbidden: not resource owner' });
  }

  req.resource = doc;
  next();
};

module.exports = { checkOwnership };
