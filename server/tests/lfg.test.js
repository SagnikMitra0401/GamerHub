const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePartyInput,
  canRequestJoin,
  openSlots,
  membershipOf,
  matchesFilters,
  MIN_SLOTS,
  MAX_SLOTS
} = require('../utils/partyRules');

const leader = '64b000000000000000000001';
const member = '64b000000000000000000002';
const outsider = '64b000000000000000000003';

const party = (overrides = {}) => ({
  _id: '64b000000000000000000010',
  leaderId: leader,
  maxSlots: 3,
  members: [{ userId: leader, role: 'leader' }],
  requests: [],
  requirements: { minRank: '', micRequired: false },
  status: 'open',
  expiresAt: new Date(Date.now() + 60_000),
  gameTitle: 'Valorant',
  ...overrides
});

test('party input requires a game and a sane squad size', () => {
  assert.equal(normalizePartyInput({}).ok, false);
  assert.equal(normalizePartyInput({ gameTitle: '   ' }).ok, false);

  assert.equal(normalizePartyInput({ gameTitle: 'Valorant', maxSlots: MIN_SLOTS - 1 }).ok, false);
  assert.equal(normalizePartyInput({ gameTitle: 'Valorant', maxSlots: MAX_SLOTS + 1 }).ok, false);
  assert.equal(normalizePartyInput({ gameTitle: 'Valorant', maxSlots: 'two' }).ok, false);

  const ok = normalizePartyInput({ gameTitle: '  Valorant ', maxSlots: 4 });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.gameTitle, 'Valorant');
  assert.equal(ok.value.maxSlots, 4);
});

test('party input defaults to five slots and drops unsafe thumbnails', () => {
  const { value } = normalizePartyInput({ gameTitle: 'Apex Legends' });
  assert.equal(value.maxSlots, 5);
  assert.equal(value.gameThumbnail, null);

  assert.equal(
    normalizePartyInput({ gameTitle: 'Apex', gameThumbnail: 'javascript:alert(1)' }).value.gameThumbnail,
    null
  );
  assert.equal(
    normalizePartyInput({ gameTitle: 'Apex', gameThumbnail: 'https://cdn.example.com/a.jpg' }).value.gameThumbnail,
    'https://cdn.example.com/a.jpg'
  );
});

test('party input normalises requirements', () => {
  const { value } = normalizePartyInput({
    gameTitle: 'Overwatch 2',
    requirements: { minRank: '  Diamond+  ', micRequired: 'yes' }
  });
  assert.equal(value.requirements.minRank, 'Diamond+');
  assert.equal(value.requirements.micRequired, true);
});

test('open slots never go negative', () => {
  assert.equal(openSlots(party()), 2);
  assert.equal(openSlots(party({ members: [{ userId: leader }, { userId: member }, { userId: outsider }] })), 0);
  assert.equal(openSlots(party({ members: [1, 2, 3, 4].map((n) => ({ userId: String(n) })) })), 0);
  assert.equal(openSlots(null), 0);
});

test('join rules reject the leader, members, duplicates, full and closed squads', () => {
  assert.equal(canRequestJoin(party(), outsider).ok, true);

  const leaderCheck = canRequestJoin(party(), leader);
  assert.equal(leaderCheck.ok, false);
  assert.match(leaderCheck.reason, /leader/i);

  const memberCheck = canRequestJoin(party({ members: [{ userId: leader }, { userId: member }] }), member);
  assert.equal(memberCheck.ok, false);
  assert.match(memberCheck.reason, /already in this squad/i);

  const duplicate = canRequestJoin(party({ requests: [{ userId: outsider }] }), outsider);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.reason, /already asked/i);

  const full = canRequestJoin(
    party({ members: [{ userId: leader }, { userId: member }, { userId: '64b000000000000000000004' }] }),
    outsider
  );
  assert.equal(full.ok, false);
  assert.match(full.reason, /full/i);

  const closed = canRequestJoin(party({ status: 'closed' }), outsider);
  assert.equal(closed.ok, false);

  const missing = canRequestJoin(null, outsider);
  assert.equal(missing.ok, false);
});

test('expired squads cannot be joined or listed', () => {
  const expired = party({ expiresAt: new Date(Date.now() - 1000) });
  const result = canRequestJoin(expired, outsider);
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired/i);
  assert.equal(matchesFilters(expired), false);
});

test('membership reports the viewer relationship', () => {
  assert.equal(membershipOf(party(), leader), 'leader');
  assert.equal(membershipOf(party({ members: [{ userId: leader }, { userId: member }] }), member), 'member');
  assert.equal(membershipOf(party({ requests: [{ userId: outsider }] }), outsider), 'pending');
  assert.equal(membershipOf(party(), outsider), 'none');
  assert.equal(membershipOf(null, outsider), 'none');
});

test('board filters match game, mic requirement and open slots', () => {
  const valorant = party({ gameTitle: 'Valorant', requirements: { micRequired: true, minRank: '' } });
  assert.equal(matchesFilters(valorant, {}), true);
  assert.equal(matchesFilters(valorant, { game: 'valo' }), true);
  assert.equal(matchesFilters(valorant, { game: 'apex' }), false);
  assert.equal(matchesFilters(valorant, { mic: '1' }), true);

  const noMic = party({ requirements: { micRequired: false, minRank: '' } });
  assert.equal(matchesFilters(noMic, { mic: '1' }), false);

  const nearlyFull = party({ members: [{ userId: leader }, { userId: member }, { userId: outsider }] });
  assert.equal(matchesFilters(nearlyFull, { openSlots: '1' }), false);
  assert.equal(matchesFilters(party(), { openSlots: '1' }), true);
  assert.equal(matchesFilters(party({ status: 'full' }), { openSlots: '1' }), false);
});
