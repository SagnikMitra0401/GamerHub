const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVIDENCE_RETENTION_MONTHS,
  AUDIT_RETENTION_YEARS,
  ABANDONED_APPLICATION_DAYS,
  ABANDONED_APPLICATION_MAX_MONTHS,
  EVIDENCE_FIELDS,
  evidencePurgeCutoff,
  auditPurgeCutoff,
  abandonedApplicationCutoff,
  abandonedApplicationMaxCutoff,
  abandonedApplicationFilter,
  retentionClaim,
  expireAbandonedBusinessApplications,
  evidencePurgeFilter,
  purgeExpiredBusinessEvidence,
  purgeExpiredBusinessAudits
} = require('../utils/businessRetention');
const { retentionNotice, notifyBusinessRetention } = require('../utils/businessRetentionNotices');

const NOW = new Date('2029-11-22T12:00:00.000Z');

function fakeProfiles(candidates = [], { afterUpdate = candidates } = {}) {
  const calls = { findCount: 0 };
  return {
    calls,
    find(filter) {
      calls.findCount += 1;
      if (calls.findCount === 1) calls.filter = filter;
      const rows = calls.findCount === 1 ? candidates : afterUpdate;
      return {
        select() { return this; },
        limit(value) { calls.limit = value; return this; },
        async lean() { return rows; }
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

test('an application lapses after 90 days without activity, or 12 months open', () => {
  assert.equal(ABANDONED_APPLICATION_DAYS, 90);
  assert.equal(ABANDONED_APPLICATION_MAX_MONTHS, 12);

  const cutoff = abandonedApplicationCutoff(NOW);
  const maxCutoff = abandonedApplicationMaxCutoff(NOW);
  assert.equal(cutoff.toISOString(), '2029-08-24T12:00:00.000Z');
  // A cosmetic edit bumps `updatedAt`; the absolute cap still closes the file.
  assert.equal(maxCutoff.toISOString(), '2028-11-22T12:00:00.000Z');

  assert.deepEqual(abandonedApplicationFilter(cutoff, maxCutoff), {
    verificationStatus: 'pending',
    verificationRequestedAt: { $ne: null, $lte: cutoff },
    $or: [
      { updatedAt: { $lte: cutoff } },
      { verificationRequestedAt: { $lte: maxCutoff } }
    ]
  });
});

test('abandoned applications are closed, audited and claimed for notices', async () => {
  const store = fakeProfiles([
    {
      _id: 'a',
      userId: 'u1',
      displayName: 'Acme',
      contactEmail: 'a@acme.test',
      verificationRequestedAt: new Date('2029-06-01T00:00:00.000Z')
    },
    {
      _id: 'b',
      userId: 'u2',
      displayName: 'Beta',
      supportEmail: 'b@beta.test',
      verificationRequestedAt: new Date('2029-07-01T00:00:00.000Z')
    }
  ]);
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
  assert.match(inserted[0].note, /12 months open/);
  assert.equal(inserted[0].actorId, null);

  // Owner details are read before the update, so the worker can notify them.
  assert.equal(result.claims.length, 2);
  assert.equal(result.claims[0].userId, 'u1');
  assert.equal(result.claims[0].contactEmail, 'a@acme.test');
  assert.equal(result.claims[1].supportEmail, 'b@beta.test');
  assert.equal(
    result.claims[0].verificationRequestedAt.toISOString(),
    '2029-06-01T00:00:00.000Z'
  );
});

test('an application decided during the sweep is not audited or announced as expired', async () => {
  // The reviewer verified the profile between the read and the update, so the
  // re-read of rows this run actually moved comes back empty.
  const store = fakeProfiles([{ _id: 'a', userId: 'u1' }], { afterUpdate: [] });
  let inserted = 0;

  const result = await expireAbandonedBusinessApplications({
    now: NOW,
    profiles: store,
    audits: { async insertMany(rows) { inserted += rows.length; } }
  });

  assert.equal(result.expired, 0);
  assert.deepEqual(result.claims, []);
  assert.equal(inserted, 0, 'no false expired audit row');
  assert.equal(store.calls.findCount, 2, 'the sweep re-reads what it moved');
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
  assert.deepEqual(result.claims, []);
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
  const store = fakeProfiles([
    {
      _id: 'a',
      userId: 'u1',
      displayName: 'Acme',
      contactEmail: 'a@acme.test',
      reviewDecidedAt: new Date('2027-10-01T00:00:00.000Z')
    },
    { _id: 'b', userId: 'u2', displayName: 'Beta' }
  ]);
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

  // The contact is captured before being emptied, so the purge notice still
  // has somewhere to go for this run.
  assert.equal(result.claims[0].contactEmail, 'a@acme.test');
  assert.equal(
    result.claims[0].reviewDecidedAt.toISOString(),
    '2027-10-01T00:00:00.000Z'
  );
});

test('an empty evidence sweep does not issue an update', async () => {
  const store = fakeProfiles([]);
  const result = await purgeExpiredBusinessEvidence({ now: NOW, profiles: store });

  assert.equal(result.profiles, 0);
  assert.equal(store.calls.updateMany, undefined);
  assert.deepEqual(result.claims, []);
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

test('retention notices explain the change and are unique per review round', () => {
  const expired = retentionNotice('expired', {
    id: 'p1',
    displayName: 'Acme',
    verificationRequestedAt: new Date('2029-06-01T00:00:00.000Z')
  });
  assert.equal(expired.title, 'Business verification request expired');
  assert.match(expired.message, /Acme/);
  assert.match(expired.message, /90 days/);
  assert.equal(expired.actionUrl, '/settings?tab=business');
  assert.equal(expired.dedupeKey, 'business-verification-expired:p1:2029-06-01');

  const purged = retentionNotice('purged', {
    id: 'p2',
    displayName: 'Acme',
    reviewDecidedAt: new Date('2027-10-01T00:00:00.000Z')
  });
  assert.equal(purged.title, 'Business review evidence deleted');
  assert.match(purged.message, /2027-10-01/);
  assert.match(purged.message, /24-month/);
  assert.equal(purged.dedupeKey, 'business-evidence-purged:p2:2027-10-01');

  assert.throws(() => retentionNotice('other', { id: 'p3' }), /Unknown business retention notice/);
});

test('retention notices reach the owner in-app and by official email', async () => {
  const stored = [];
  const sent = [];
  const logged = [];

  const result = await notifyBusinessRetention([
    { id: 'p1', userId: 'u1', displayName: 'Acme', contactEmail: 'a@acme.test' },
    { id: 'p2', userId: 'u2', displayName: 'Beta', supportEmail: 'b@beta.test' },
    { id: 'p3', userId: 'u3', displayName: 'Gamma' },
    { id: 'p4', userId: null, displayName: 'No owner' }
  ], {
    kind: 'expired',
    notifyUser: async (input) => { stored.push(input); return input; },
    sendEmail: async (input) => {
      if (input.to === 'b@beta.test') throw new Error('mailbox unavailable');
      sent.push(input);
    },
    log: (message) => logged.push(message)
  });

  assert.equal(result.notified, 3, 'a claim without an owner is skipped');
  assert.equal(result.emailed, 1);
  assert.equal(result.failed, 1, 'one bad address must not stop the batch');
  assert.equal(logged.length, 1);

  assert.equal(stored[0].actionUrl, '/settings?tab=business');
  assert.equal(stored[0].metadata.important, true, 'account-status notices are durable');
  assert.equal(stored[0].dedupeKey, 'business-verification-expired:p1:an earlier date');
  assert.notEqual(stored[0].dedupeKey, stored[1].dedupeKey);
  assert.equal(sent[0].to, 'a@acme.test');
  assert.equal(sent[0].kind, 'expired');
});

test('a legacy decision date labels the purge notice instead of "an earlier date"', () => {
  const claim = retentionClaim({
    _id: 'p4',
    userId: 'u4',
    demotedAt: new Date('2025-04-05T00:00:00.000Z')
  });
  assert.equal(claim.reviewDecidedAt.toISOString(), '2025-04-05T00:00:00.000Z');
  assert.match(retentionNotice('purged', claim).message, /2025-04-05/);
});
