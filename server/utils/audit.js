const AuditLog = require('../models/AuditLog');

/**
 * Append an immutable moderation/administration entry.
 * Never throws: auditing must not break the request that triggered it.
 */
async function recordAudit({
  communityId,
  actorId,
  actionType,
  targetId = null,
  targetModel = null,
  metadata = {},
}) {
  try {
    // Platform entries deliberately carry no community; only the actor is mandatory.
    if (!actorId) return null;
    return await AuditLog.create({
      communityId,
      actorId,
      actionType,
      targetId,
      targetModel,
      metadata,
    });
  } catch (err) {
    console.error('[AuditLog] write failed:', err.message);
    return null;
  }
}

module.exports = { recordAudit };
module.exports.recordPlatformAudit = (payload) => recordAudit({ communityId: null, ...payload });
