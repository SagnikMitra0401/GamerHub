/**
 * Owner notices for the business retention sweeps.
 *
 * Expiry and evidence deletion change database fields silently, and the owner
 * may never open the settings page that explains them. Each swept profile gets
 * one in-app notice, plus an email to the official address while it is still on
 * file (the purge clears it). Delivery is best-effort per profile: one bouncing
 * address must not stop the rest of the batch or fail the sweep.
 */

const NOTICE_COPY = Object.freeze({
  expired: {
    title: 'Business verification request expired',
    action: 'expired'
  },
  purged: {
    title: 'Business review evidence deleted',
    action: 'purged'
  }
});

/** Calendar day only: the notice is about a policy window, not a timestamp. */
function day(value) {
  if (!value) return 'an earlier date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'an earlier date' : date.toISOString().slice(0, 10);
}

/**
 * In-app copy and idempotency key for one swept profile.
 *
 * The key includes the round (request or decision date), so a business that
 * applies again and lapses again gets a second, honest notice.
 */
function retentionNotice(kind, claim = {}) {
  const copy = NOTICE_COPY[kind];
  if (!copy) throw new Error(`Unknown business retention notice: ${kind}`);

  const name = claim.displayName || 'your business';
  if (kind === 'expired') {
    return {
      title: copy.title,
      message:
        `Your verification request for ${name} expired: it had no activity for 90 days, ` +
        'or stayed open for 12 months. Apply again from business settings when ready.',
      actionUrl: '/settings?tab=business',
      dedupeKey: `business-verification-expired:${claim.id || 'unknown'}:${day(claim.verificationRequestedAt)}`,
      // An account-status notice must outlive the 15-day ordinary TTL: losing it
      // makes the change look unexplained.
      metadata: { businessProfileId: claim.id || null, important: true }
    };
  }

  return {
    title: copy.title,
    message:
      `The official contact and proof details from the review decided on ${day(claim.reviewDecidedAt)} ` +
      'were deleted under the 24-month retention policy. The decision and its reason stay on record.',
    actionUrl: '/settings?tab=business',
    dedupeKey: `business-evidence-purged:${claim.id || 'unknown'}:${day(claim.reviewDecidedAt)}`,
    metadata: { businessProfileId: claim.id || null, important: true }
  };
}

/**
 * @param {Array<object>} claims output of a retention sweep
 * @param {{kind: 'expired'|'purged', notifyUser?: Function, sendEmail?: Function, log?: Function}} options
 * @returns {Promise<{notified: number, emailed: number, failed: number}>}
 */
async function notifyBusinessRetention(claims, {
  kind,
  notifyUser,
  sendEmail,
  log = console.error
}) {
  const notify = notifyUser || require('./notify').notifyUser;
  const email = sendEmail || require('./email').sendBusinessRetentionEmail;

  let notified = 0;
  let emailed = 0;
  let failed = 0;

  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!claim?.userId) continue;

    const notice = retentionNotice(kind, claim);
    const stored = await notify({ userId: claim.userId, ...notice });
    if (stored) notified += 1;

    // Only the official address: the account email is a login credential, and
    // these notices already exist in the app.
    const to = claim.contactEmail || claim.supportEmail || '';
    if (!to) continue;

    try {
      await email({
        to,
        displayName: claim.displayName,
        kind,
        decidedAt: claim.reviewDecidedAt
      });
      emailed += 1;
    } catch (err) {
      failed += 1;
      log(`[Retention] business ${kind} email failed:`, err.message);
    }
  }

  return { notified, emailed, failed };
}

module.exports = { retentionNotice, notifyBusinessRetention, NOTICE_COPY };
