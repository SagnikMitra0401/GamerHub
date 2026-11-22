/**
 * Auth domain: make the business evidence clock explicit.
 *
 * Profiles decided before `reviewDecidedAt` existed only carry `verifiedAt` or
 * `demotedAt`. The retention sweep has a fallback for those rows, but writing
 * the field makes the 24-month window visible to owners and reviewers and
 * removes an invisible special case from every purge query.
 */
module.exports = {
  async up(db) {
    const profiles = db.collection('businessprofiles');

    await profiles.updateMany(
      { reviewDecidedAt: null, verifiedAt: { $ne: null } },
      [{ $set: { reviewDecidedAt: '$verifiedAt' } }]
    );

    // A demoted profile has no verifiedAt, and a decision stamp already set by
    // a newer verification must not be overwritten by the older demotion.
    await profiles.updateMany(
      { reviewDecidedAt: null, demotedAt: { $ne: null } },
      [{ $set: { reviewDecidedAt: '$demotedAt' } }]
    );
  },

  async down() {
    // A backfilled clock is indistinguishable from a real decision timestamp,
    // so rolling back the code leaves it in place rather than guessing. The
    // sweep treats both values identically.
  }
};
