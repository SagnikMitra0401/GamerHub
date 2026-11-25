const DAY_MS = 24 * 60 * 60 * 1000;

// Engagement pings are useful for the notification funnel, but opening the bell
// is not a meaningful day-7 return. Keep them out of retention.
const DAY7_IGNORED_EVENTS = ['notification_opened', 'notification_clicked'];

const percent = (part, total) => {
  if (!total) return 0;
  return Math.round((part / total) * 10000) / 100;
};

/**
 * Collapse one aggregation row per account into the nested funnel counts.
 *
 * `names` is the distinct set of tracked events for that account, so duplicate
 * signup rows cannot inflate a step. Connection requires onboarding
 * completion, and contribution requires connection; skipped onboarding is
 * reported separately.
 */
function summarizeFunnelRows(rows = []) {
  const counts = {
    signups: 0,
    onboardingCompleted: 0,
    onboardingSkipped: 0,
    firstConnection: 0,
    firstContribution: 0,
  };

  for (const row of rows) {
    if (!row || !Array.isArray(row.names) || !row.names.includes('signup')) continue;
    const names = new Set(row.names);
    counts.signups += 1;

    if (names.has('onboarding_skipped')) counts.onboardingSkipped += 1;
    if (!names.has('onboarding_completed')) continue;
    counts.onboardingCompleted += 1;

    if (!names.has('first_join') && !names.has('first_follow')) continue;
    counts.firstConnection += 1;

    if (!names.has('first_post') && !names.has('first_comment') && !names.has('first_message'))
      continue;
    counts.firstContribution += 1;
  }

  return counts;
}

/**
 * Build the activation funnel response from already-counted distinct users.
 *
 * Day-7 is intentionally an approximation: it asks whether a signup has any
 * meaningful event in the [signup + 7d, signup + 8d) window. It is a cohort
 * direction, not a warehouse-grade retention calculation.
 */
function buildFunnel({
  signups = 0,
  onboardingCompleted = 0,
  onboardingSkipped = 0,
  firstConnection = 0,
  firstContribution = 0,
  day7Returned = 0,
  day7Cohort = 0,
} = {}) {
  const steps = [
    {
      key: 'signup',
      label: 'Signed up',
      users: signups,
      rateFromPrevious: percent(signups, signups),
      rateFromSignup: percent(signups, signups),
    },
    {
      key: 'onboarding_completed',
      label: 'Completed onboarding',
      users: onboardingCompleted,
      rateFromPrevious: percent(onboardingCompleted, signups),
      rateFromSignup: percent(onboardingCompleted, signups),
    },
    {
      key: 'first_connection',
      label: 'Joined a server or followed a player',
      users: firstConnection,
      rateFromPrevious: percent(firstConnection, onboardingCompleted),
      rateFromSignup: percent(firstConnection, signups),
    },
    {
      key: 'first_contribution',
      label: 'Posted, commented or messaged',
      users: firstContribution,
      rateFromPrevious: percent(firstContribution, firstConnection),
      rateFromSignup: percent(firstContribution, signups),
    },
    {
      key: 'day_7_return',
      label: 'Returned on day 7',
      users: day7Returned,
      eligibleUsers: day7Cohort,
      rateFromPrevious: null,
      rateFromSignup: percent(day7Returned, signups),
      rateFromEligible: percent(day7Returned, day7Cohort),
    },
  ];

  return {
    steps,
    skippedOnboarding: onboardingSkipped,
    day7: {
      approximate: true,
      returned: day7Returned,
      cohort: day7Cohort,
      rate: percent(day7Returned, day7Cohort),
    },
  };
}

module.exports = { DAY_MS, DAY7_IGNORED_EVENTS, buildFunnel, summarizeFunnelRows };
