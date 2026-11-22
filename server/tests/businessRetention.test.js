const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVIDENCE_RETENTION_MONTHS,
  AUDIT_RETENTION_YEARS,
  ABANDONED_APPLICATION_DAYS,
  EVIDENCE_FIELDS,
  evidencePurgeCutoff,
  auditPurgeCutoff,
  abandonedApplicationCutoff,
  abandonedApplicationFilter,
  expireAbandonedBusinessApplications,
  evidencePurgeFilter,
  purgeExpiredBusinessEvidence,
  purgeExpiredBusinessAudits
} = require('../utils/businessRetention');

const NOW = new Date('2029-11-22T12:00:00.000Z');

function fakeProfiles(candidates = []) {
  const calls = {};
  return {
    calls,
    find(filter) {
      calls.filter = filter;
      return {
        select() { return this; },
        limit(value) { calls.limit = value; return this; },
        async lean() { return candidates; }
      };
    },
    async updateMany(filter, update) {
      calls.updateMany = { filter, update };
      return { modifiedCount: candidates.length };
    }
  };
}

test('evidence is kept for 24 calendar months after the decision', () => {
  assert.equal(EVIDENCE_RETENTION_MONTHS, 24);
  assert.equal(evidencePurgeCutoff(NOW).toISOString(), '2027-11-22T12:00:00.000Z');

  // Calendar arithmetic, not 730 days: a leap day lands on the end of February.
  assert.equal(
    evidencePurgeCutoff(new Date('2028-02-29T09:30:00.000Z')).toISOString(),
    '2026-02-28T09:30:00.000Z'
  );
});

test('the review audit is kept for 3 years', () => {
  assert.equal(AUDIT_RETENTION_YEARS, 3);
  assert.equal(auditPurgeCutoff(NOW).toISOString(), '2026-11-22T12:00:00.000Z');
  assert.equal(
    auditPurgeCutoff(new Date('2028-02-29T00:00:00.000Z')).toISOString(),
    '2025-02-28T00:00:00.000Z'
  );
});

test('an application is abandoned after 90 days without activity', () => {
  assert.equal(ABANDONED_APPLICATION_DAYS, 90);
  const cutoff = abandonedApplicationCutoff(NOW);
  assert.equal(cutoff.toISOString(), '2029-08-24T12:00:00.000Z');

  assert.deepEqual(abandonedApplicationFilter(cutoff), {
    verificationStatus: 'pending',
    verificationRequestedAt: { $ne: null, $lte: cutoff },
    updatedAt: { $lte: cutoff }
  });
});

test('abandoned applications are closed and audited', async () => {
  const store = fakeProfiles([{ _id: 'a' }, { _id: 'b' }]);
  let inserted = [];

  const result = await expireAbandonedBusinessApplications({
    now: NOW,
    profiles: store,
    audits: {
      async insertMany(rows) { inserted = rows; }
    }
  });

  assert.equal(result.expired, 2);
  assert.equal(result.cutoff.toISOString(), '2029-08-24T12:00:00.000Z');

  const { $set } = store.calls.updateMany.update;
  assert.equal($set.verificationStatus, 'expired');
  assert.equal($set.verificationToken, '');
  assert.equal($set.verificationMethod, null);
  assert.equal($set.reviewDecidedAt, NOW, 'expiry starts the evidence clock');

  assert.equal(inserted.length, 2);
  assert.equal(inserted[0].status, 'expired');
  assert.match(inserted[0].note, /90 days without activity/);
  assert.equal(inserted[0].actorId, null);
});

test('an empty abandonment sweep writes nothing', async () => {
  const store = fakeProfiles([]);
  let inserted = 0;
  const result = await expireAbandonedBusinessApplications({
    now: NOW,
    profiles: store,
    audits: { async insertMany(rows) { inserted += rows.length; } }
  });

  assert.equal(result.expired, 0);
  assert.equal(store.calls.updateMany, undefined);
  assert.equal(inserted, 0);
});

test('the evidence sweep targets only decided profiles that still hold evidence', () => {
  const filter = evidencePurgeFilter(evidencePurgeCutoff(NOW));
  const cutoff = new Date('2027-11-22T12:00:00.000Z');

  assert.deepEqual(filter.$and[0].$or, [
    { reviewDecidedAt: { $ne: null, $lte: cutoff } },
    { reviewDecidedAt: null, verifiedAt: { $ne: null, $lte: cutoff } },
    { reviewDecidedAt: null, demotedAt: { $ne: null, $lte: cutoff } }
  ]);

  assert.equal(filter.$and[1].$or.length, EVIDENCE_FIELDS.length);
  for (const field of EVIDENCE_FIELDS) {
    assert.ok(
      filter.$and[1].$or.some((clause) => clause[field]?.$exists === true && clause[field]?.$ne === ''),
      `${field} must be cleared only when present and non-empty`
    );
  }
});

test('old evidence is cleared in place and marked, leaving the audit intact', async () => {
  const store = fakeProfiles([{ _id: 'a' }, { _id: 'b' }]);
  const result = await purgeExpiredBusinessEvidence({ now: NOW, profiles: store });

  assert.equal(result.profiles, 2);
  assert.equal(result.cutoff.toISOString(), '2027-11-22T12:00:00.000Z');
  assert.equal(store.calls.limit, 500);

  const { $set } = store.calls.updateMany.update;
  for (const field of EVIDENCE_FIELDS) {
    assert.equal($set[field], '', `${field} must be emptied`);
  }
  assert.equal($set.evidencePurgedAt, NOW);
  assert.equal('demotionReason' in $set, false, 'the decision reason is audit data, not evidence');
  assert.equal('displayName' in $set, false, 'the public card is untouched');
});

test('an empty evidence sweep does not issue an update', async () => {
  const store = fakeProfiles([]);
  const result = await purgeExpiredBusinessEvidence({ now: NOW, profiles: store });

  assert.equal(result.profiles, 0);
  assert.equal(store.calls.updateMany, undefined);
});

test('audit rows older than the defence window are deleted', async () => {
  const calls = {};
  const result = await purgeExpiredBusinessAudits({
    now: NOW,
    audits: {
      async deleteMany(filter) {
        calls.filter = filter;
        return { deletedCount: 7 };
      }
    }
  });

  assert.equal(result.audits, 7);
  assert.deepEqual(calls.filter, { createdAt: { $lt: new Date('2026-11-22T12:00:00.000Z') } });
});

test('an empty audit sweep reports zero, not undefined', async () => {
  const result = await purgeExpiredBusinessAudits({
    now: NOW,
    audits: { async deleteMany() { return {}; } }
  });
  assert.equal(result.audits, 0);
});
