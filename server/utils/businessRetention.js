const BusinessProfile = require('../models/BusinessProfile');
const BusinessVerificationAudit = require('../models/BusinessVerificationAudit');

/**
 * Business review retention (Phase 17 §4.2).
 *
 * - Evidence (official contact, proof link/note, the owner's answer) is kept
 *   while an application is open and for 24 months after the decision.
 * - The decision/correspondence audit is kept for 3 years, and the contact
 *   audit stores an excerpt rather than the whole message body.
 *
 * Cutoffs are calendar-aware: "24 months" must mean the same day two years
 * later, not 730 days, and "3 years" must survive leap years.
 */
const EVIDENCE_RETENTION_MONTHS = 24;
const AUDIT_RETENTION_YEARS = 3;
/** An application with no activity for this long is treated as abandoned. */
const ABANDONED_APPLICATION_DAYS = 90;
/** Hard limit: an application this old lapses even if edits keep it active. */
const ABANDONED_APPLICATION_MAX_MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 500;

const EVIDENCE_FIELDS = Object.freeze([
  'contactEmail',
  'contactDetail',
  'proofUrl',
  'proofNote',
  'reviewResponseNote',
]);

/** Last calendar day of the month that holds `date`. */
function lastDayOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Move back whole months without letting JS roll 31 Jan + 1 month into March.
 * The day is clamped to the target month, so a leap-day decision expires on
 * 28 February rather than one day later.
 */
function monthsBefore(now, months) {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  date.setUTCDate(Math.min(day, lastDayOfMonth(date)));
  return date;
}

function yearsBefore(now, years) {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(Math.min(day, lastDayOfMonth(date)));
  return date;
}

function evidencePurgeCutoff(now = new Date()) {
  return monthsBefore(now, EVIDENCE_RETENTION_MONTHS);
}

function abandonedApplicationCutoff(now = new Date()) {
  return new Date(new Date(now).getTime() - ABANDONED_APPLICATION_DAYS * DAY_MS);
}

function abandonedApplicationMaxCutoff(now = new Date()) {
  return monthsBefore(now, ABANDONED_APPLICATION_MAX_MONTHS);
}

function auditPurgeCutoff(now = new Date()) {
  return yearsBefore(now, AUDIT_RETENTION_YEARS);
}

/**
 * Pending applications that are due to lapse.
 *
 * `updatedAt` moves on an owner edit, a reviewer contact or a response, so any
 * of those keeps an application alive inside the inactivity window. The
 * absolute cutoff exists because cosmetic edits bump `updatedAt` too, and no
 * amount of editing should keep an undecided application open forever.
 */
function abandonedApplicationFilter(inactivityCutoff, absoluteCutoff = inactivityCutoff) {
  return {
    verificationStatus: 'pending',
    verificationRequestedAt: { $ne: null, $lte: inactivityCutoff },
    $or: [
      { updatedAt: { $lte: inactivityCutoff } },
      { verificationRequestedAt: { $lte: absoluteCutoff } },
    ],
  };
}

/** A minimal owner-facing view of a swept profile, for notices. */
function retentionClaim(row) {
  return {
    id: String(row._id),
    userId: row.userId ? String(row.userId) : null,
    displayName: row.displayName || '',
    contactEmail: row.contactEmail || '',
    supportEmail: row.supportEmail || '',
    verificationRequestedAt: row.verificationRequestedAt || null,
    // Legacy rows decided before `reviewDecidedAt` existed still deserve the
    // real date in their notice, not "an earlier date".
    reviewDecidedAt: row.reviewDecidedAt || row.verifiedAt || row.demotedAt || null,
  };
}

/**
 * Mongo filter for profiles whose decision is old enough to drop evidence.
 *
 * `reviewDecidedAt` is authoritative, but businesses decided before that field
 * existed only have `verifiedAt`/`demotedAt`; those are accepted as a fallback
 * so retention does not silently skip older rows.
 */
function evidencePurgeFilter(cutoff) {
  return {
    $and: [
      {
        $or: [
          { reviewDecidedAt: { $ne: null, $lte: cutoff } },
          { reviewDecidedAt: null, verifiedAt: { $ne: null, $lte: cutoff } },
          { reviewDecidedAt: null, demotedAt: { $ne: null, $lte: cutoff } },
        ],
      },
      { $or: EVIDENCE_FIELDS.map((field) => ({ [field]: { $exists: true, $ne: '' } })) },
    ],
  };
}

/**
 * Close applications nobody acted on. Without this, a pending application
 * would keep its contact and proof forever because no decision is ever made.
 * Expiry starts the evidence clock and tells the owner the request lapsed;
 * they can apply again, which reopens it.
 */
async function expireAbandonedBusinessApplications({
  now = new Date(),
  profiles = BusinessProfile,
  audits = BusinessVerificationAudit,
} = {}) {
  const cutoff = abandonedApplicationCutoff(now);
  const maxCutoff = abandonedApplicationMaxCutoff(now);
  const candidates = await profiles
    .find(abandonedApplicationFilter(cutoff, maxCutoff))
    // The owner fields are read before the update so the worker can tell the
    // owner what happened without a second query over every expired row.
    .select('_id userId displayName contactEmail supportEmail verificationRequestedAt')
    .limit(SWEEP_BATCH)
    .lean();
  if (!candidates.length) return { expired: 0, cutoff, claims: [] };

  const ids = candidates.map((row) => row._id);
  await profiles.updateMany(
    { _id: { $in: ids }, verificationStatus: 'pending' },
    {
      $set: {
        verificationStatus: 'expired',
        verificationMethod: null,
        verificationDomain: '',
        verificationToken: '',
        reviewDecidedAt: now,
      },
    },
  );

  // Only rows this run moved. A reviewer who decided between the read and the
  // update must not receive a false "expired" audit row or owner notice, and a
  // second worker running the same sweep must not duplicate either.
  const expiredRows = await profiles
    .find({ _id: { $in: ids }, verificationStatus: 'expired', reviewDecidedAt: now })
    .select('_id userId displayName contactEmail supportEmail verificationRequestedAt')
    .lean();
  if (!expiredRows.length) return { expired: 0, cutoff, claims: [] };

  await audits.insertMany(
    expiredRows.map((row) => ({
      businessProfileId: row._id,
      actorId: null,
      status: 'expired',
      note: `Application expired after ${ABANDONED_APPLICATION_DAYS} days without activity or ${ABANDONED_APPLICATION_MAX_MONTHS} months open.`,
    })),
  );

  return {
    expired: expiredRows.length,
    cutoff,
    claims: expiredRows.map(retentionClaim),
  };
}

/**
 * Delete the private review evidence of decided applications older than the
 * retention window. Public fields, the audit trail and the account itself are
 * untouched, so a demoted business keeps its record without the paperwork.
 *
 * @param {{now?: Date, profiles?: object}} options profiles is injectable so
 *   the sweep can be unit-tested without MongoDB.
 */
async function purgeExpiredBusinessEvidence({ now = new Date(), profiles = BusinessProfile } = {}) {
  const cutoff = evidencePurgeCutoff(now);
  const candidates = await profiles
    .find(evidencePurgeFilter(cutoff))
    // Recipient details are captured before the contact fields are emptied, so
    // the owner can still be told that the retention window closed.
    .select('_id userId displayName contactEmail supportEmail reviewDecidedAt verifiedAt demotedAt')
    .limit(SWEEP_BATCH)
    .lean();
  if (!candidates.length) return { profiles: 0, cutoff, claims: [] };

  const set = { evidencePurgedAt: now };
  for (const field of EVIDENCE_FIELDS) set[field] = '';

  const result = await profiles.updateMany(
    { _id: { $in: candidates.map((row) => row._id) } },
    { $set: set },
  );

  return {
    profiles: result.modifiedCount || 0,
    cutoff,
    claims: candidates.map(retentionClaim),
  };
}

/**
 * Drop audit rows past the defence window. Each row is one decision or
 * correspondence event, so the cutoff is applied per row.
 */
async function purgeExpiredBusinessAudits({
  now = new Date(),
  audits = BusinessVerificationAudit,
} = {}) {
  const cutoff = auditPurgeCutoff(now);
  const result = await audits.deleteMany({ createdAt: { $lt: cutoff } });
  return { audits: result.deletedCount || 0, cutoff };
}

module.exports = {
  EVIDENCE_RETENTION_MONTHS,
  AUDIT_RETENTION_YEARS,
  ABANDONED_APPLICATION_DAYS,
  ABANDONED_APPLICATION_MAX_MONTHS,
  EVIDENCE_FIELDS,
  monthsBefore,
  yearsBefore,
  evidencePurgeCutoff,
  auditPurgeCutoff,
  abandonedApplicationCutoff,
  abandonedApplicationMaxCutoff,
  retentionClaim,
  abandonedApplicationFilter,
  expireAbandonedBusinessApplications,
  evidencePurgeFilter,
  purgeExpiredBusinessEvidence,
  purgeExpiredBusinessAudits,
};
