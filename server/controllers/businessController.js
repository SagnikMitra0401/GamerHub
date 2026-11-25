const crypto = require('crypto');

const BusinessProfile = require('../models/BusinessProfile');
const BusinessTeamMember = require('../models/BusinessTeamMember');
const BusinessVerificationAudit = require('../models/BusinessVerificationAudit');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

const { badRequest, notFound, conflict } = require('../utils/httpError');
const {
  BUSINESS_REVIEW_RESPONSE_DAYS,
  BUSINESS_VERIFICATION_METHODS,
  sanitizeBusinessProfile,
  publicBusinessProfile,
  ownerBusinessProfile,
  manualReviewReadiness,
  sanitizeReviewResponse,
  demotionReadiness,
  verificationDomainFor,
} = require('../utils/business');
const { checkDnsToken, normalizeDomain } = require('../utils/domainVerification');
const relations = require('../utils/relations');
const { recordPlatformAudit } = require('../utils/audit');
const { sendBusinessReviewEmail } = require('../utils/email');

const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));

// The audit keeps enough of a message to explain the decision, not the whole
// email body (Phase 17 retention: reason, channel, actor, timestamp).
const AUDIT_EXCERPT_LENGTH = 160;
const auditExcerpt = (value) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > AUDIT_EXCERPT_LENGTH ? `${text.slice(0, AUDIT_EXCERPT_LENGTH - 1)}…` : text;
};

/** GET /api/business/:username — public disclosed business card. */
const getPublicBusiness = async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('username level role profileType status followerCount followers')
      .lean();
    if (!user || user.profileType !== 'creator_business') throw notFound('Business not found.');
    if (['frozen', 'suspended', 'deleted', 'deletion_pending'].includes(user.status)) {
      throw notFound('Business not found.');
    }

    const profile = await BusinessProfile.findOne({ userId: user._id }).lean();
    if (!profile) throw notFound('Business not found.');
    const { followerCount } = await relations.countsFor(user);

    res.status(200).json({
      username: user.username,
      level: user.level || 1,
      role: user.role || 'user',
      profileType: 'creator_business',
      followerCount,
      business: publicBusinessProfile(profile),
    });
  } catch (err) {
    next(err);
  }
};

/** POST /api/account/business-profile — create or update the disclosed card. */
const saveBusinessProfile = async (req, res, next) => {
  try {
    const parsed = sanitizeBusinessProfile(req.body || {});
    if (!parsed.ok) throw badRequest(parsed.reason);

    const user = await User.findById(req.user._id).select('_id profileType').lean();
    if (!user) throw notFound('User not found.');

    const existing = await BusinessProfile.findOne({ userId: req.user._id }).lean();
    const update = { ...parsed.value };

    // A verified domain can be trusted only while the website still points at
    // it. Editing the domain resets verification; editing copy does not.
    //
    // `reviewDecidedAt` is deliberately NOT cleared here: it belongs to the past
    // decision, and a profile edit must not postpone deletion of the evidence
    // that decision was based on. A later verification stamps a fresh clock.
    const oldHost = verificationDomainFor(existing);
    const newHost = verificationDomainFor({ website: update.website });
    if (existing?.verificationStatus === 'verified' && oldHost !== newHost) {
      Object.assign(update, {
        verificationStatus: 'none',
        verificationMethod: null,
        verificationDomain: '',
        verificationToken: '',
        verificationRequestedAt: null,
        verifiedAt: null,
        verifiedBy: null,
      });
    }

    const profile = await BusinessProfile.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update, $setOnInsert: { userId: req.user._id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();

    await User.updateOne({ _id: req.user._id }, { $set: { profileType: 'creator_business' } });

    res.status(200).json({
      profileType: 'creator_business',
      businessProfile: ownerBusinessProfile(profile),
    });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/account/business-profile — return to a personal profile. */
const downgradeBusiness = async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { profileType: 'personal' } });
    res.status(200).json({ profileType: 'personal' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/account/business-verification
 *
 * A domain token is generated for DNS review, or the owner can ask for manual
 * review. This endpoint never verifies itself: a staff decision is required.
 */
const requestBusinessVerification = async (req, res, next) => {
  try {
    const profile = await BusinessProfile.findOne({ userId: req.user._id });
    if (!profile) throw badRequest('Create a business profile before requesting verification.');
    if (profile.verificationStatus === 'verified') {
      return res.status(200).json({
        businessProfile: ownerBusinessProfile(profile),
        alreadyVerified: true,
      });
    }

    const method = BUSINESS_VERIFICATION_METHODS.includes(req.body?.method)
      ? req.body.method
      : 'dns';

    // Manual review is the path that can collect evidence, so it requires a
    // correspondence route plus something a reviewer can actually check.
    if (method === 'manual') {
      const readiness = manualReviewReadiness(profile);
      if (!readiness.ok) throw badRequest(readiness.reason);
    }
    const domain = String(req.body?.domain || verificationDomainFor(profile) || '')
      .trim()
      .toLowerCase()
      .slice(0, 120);
    if (method === 'dns' && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      throw badRequest('Add a valid domain to your business website before DNS verification.');
    }

    const token = method === 'dns' ? crypto.randomBytes(16).toString('hex') : '';
    profile.verificationStatus = 'pending';
    profile.verificationMethod = method;
    profile.verificationDomain = domain;
    profile.verificationToken = token;
    profile.verificationRequestedAt = new Date();
    profile.verifiedAt = null;
    profile.verifiedBy = null;
    // A fresh application needs a fresh contact attempt; an old conversation
    // must not authorise a demotion decision on new evidence.
    profile.reviewContactedAt = null;
    profile.reviewRespondedAt = null;
    profile.reviewResponseNote = '';
    profile.reviewDecidedAt = null;
    profile.demotedAt = null;
    profile.demotionReason = '';
    await profile.save();

    res.status(200).json({
      businessProfile: ownerBusinessProfile(profile),
      instructions:
        method === 'dns'
          ? {
              method,
              domain,
              recordName: `_gamerhub-verify.${domain}`,
              recordType: 'TXT',
              recordValue: `gamerhub-verify=${token}`,
            }
          : {
              method,
              message: 'An administrator will review your business details manually.',
            },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/account/business-verification/check
 *
 * Automatic path for the DNS method. The token is generated server-side; a
 * successful lookup still writes the same audit row a manual decision uses.
 */
const checkBusinessVerification = async (req, res, next) => {
  try {
    const profile = await BusinessProfile.findOne({ userId: req.user._id });
    if (!profile) throw notFound('Business profile not found.');
    if (profile.verificationStatus === 'verified') {
      return res
        .status(200)
        .json({ businessProfile: ownerBusinessProfile(profile), alreadyVerified: true });
    }
    if (profile.verificationStatus !== 'pending' || profile.verificationMethod !== 'dns') {
      throw badRequest('Request DNS verification before checking the record.');
    }

    const domain = normalizeDomain(profile.verificationDomain);
    const result = await checkDnsToken({ domain, token: profile.verificationToken });
    if (!result.ok) throw conflict(result.reason, { code: result.code });

    profile.verificationStatus = 'verified';
    profile.verifiedAt = new Date();
    profile.verifiedBy = null;
    profile.reviewDecidedAt = new Date();
    profile.outreachPaused = false;
    profile.verificationToken = '';
    await profile.save();

    await BusinessVerificationAudit.create({
      businessProfileId: profile._id,
      actorId: null,
      status: 'verified',
      note: `Automatic DNS match for ${result.recordName}`,
    });

    res.status(200).json({
      businessProfile: ownerBusinessProfile(profile),
      verified: true,
      domain: result.domain,
    });
  } catch (err) {
    next(err);
  }
};

/** GET /api/account/business/analytics — owner-only outreach counters. */
const getBusinessAnalytics = async (req, res, next) => {
  try {
    const profile = await BusinessProfile.findOne({ userId: req.user._id })
      .select('verificationStatus outreachPaused complaints')
      .lean();
    if (!profile) throw notFound('Business profile not found.');

    const [sent, accepted, active] = await Promise.all([
      Conversation.countDocuments({
        initiatorId: req.user._id,
        requestIntent: { $ne: null },
      }),
      Conversation.countDocuments({
        initiatorId: req.user._id,
        requestIntent: { $ne: null },
        state: 'active',
      }),
      Conversation.countDocuments({
        participantIds: req.user._id,
        state: 'active',
        businessThread: true,
      }),
    ]);

    res.status(200).json({
      verificationStatus: profile.verificationStatus,
      outreachPaused: Boolean(profile.outreachPaused),
      complaints: profile.complaints || 0,
      sent,
      accepted,
      active,
      acceptanceRate: sent ? Math.round((accepted / sent) * 100) : null,
    });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/business-verifications */
const getPendingBusinessVerifications = async (req, res, next) => {
  try {
    const status = ['pending', 'verified', 'rejected', 'expired', 'all'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const query =
      status === 'all'
        ? {}
        : status === 'pending'
          ? { $or: [{ verificationStatus: 'pending' }, { outreachPaused: true }] }
          : { verificationStatus: status };
    const profiles = await BusinessProfile.find(query)
      .sort({ verificationRequestedAt: 1, createdAt: 1 })
      .limit(50)
      .populate('userId', 'username email profileType status')
      .lean();

    res.status(200).json({
      responseWindowDays: BUSINESS_REVIEW_RESPONSE_DAYS,
      items: profiles.map((profile) => ({
        _id: String(profile._id),
        user: profile.userId
          ? {
              _id: String(profile.userId._id),
              username: profile.userId.username,
              email: profile.userId.email,
              status: profile.userId.status,
            }
          : null,
        business: {
          ...publicBusinessProfile(profile),
          contactEmail: profile.contactEmail || '',
          contactMethod: profile.contactMethod || 'email',
          contactDetail: profile.contactDetail || '',
          proofType: profile.proofType || 'other',
          proofUrl: profile.proofUrl || '',
          proofNote: profile.proofNote || '',
          verificationMethod: profile.verificationMethod || null,
          verificationDomain: profile.verificationDomain || '',
          reviewRespondedAt: profile.reviewRespondedAt || null,
          reviewResponseNote: profile.reviewResponseNote || '',
          reviewDecidedAt: profile.reviewDecidedAt || null,
          evidencePurgedAt: profile.evidencePurgedAt || null,
        },
        // The queue renders the same rule the endpoint enforces, so a disabled
        // Demote button always says why instead of failing on click.
        demotion: (() => {
          const readiness = demotionReadiness(profile);
          return {
            canDemote: readiness.ok,
            code: readiness.ok ? null : readiness.code,
            reason: readiness.ok ? null : readiness.reason,
            earliestDemotionAt: readiness.earliestDemotionAt || null,
            daysRemaining: readiness.daysRemaining || 0,
          };
        })(),
        token: profile.verificationToken || '',
        requestedAt: profile.verificationRequestedAt || null,
        reviewContactedAt: profile.reviewContactedAt || null,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/business-verifications/:id/resolve */
const resolveBusinessVerification = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid business profile.');
    const status = req.body?.status;
    if (!['verified', 'rejected'].includes(status)) {
      throw badRequest('Choose verified or rejected.');
    }
    const note = String(req.body?.note || '')
      .trim()
      .slice(0, 500);

    const profile = await BusinessProfile.findById(req.params.id);
    if (!profile) throw notFound('Business profile not found.');
    if (profile.verificationStatus === 'verified' && status === 'verified') {
      // A verified business can be paused by the complaint signal. The same
      // admin action doubles as the recovery path once the reports are reviewed.
      profile.outreachPaused = false;
      await profile.save();
      return res.status(200).json({
        businessProfile: ownerBusinessProfile(profile),
        status: 'verified',
        unpaused: true,
      });
    }

    profile.verificationStatus = status;
    profile.verifiedAt = status === 'verified' ? new Date() : null;
    profile.verifiedBy = status === 'verified' ? req.user._id : null;
    // Starts the 24-month evidence clock for either outcome.
    profile.reviewDecidedAt = new Date();
    if (status === 'verified') profile.outreachPaused = false;
    if (status === 'rejected') profile.verificationToken = '';
    await profile.save();

    await BusinessVerificationAudit.create({
      businessProfileId: profile._id,
      actorId: req.user._id,
      status,
      note,
    });

    res.status(200).json({
      businessProfile: ownerBusinessProfile(profile),
      status,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/business-verifications/:id/contact
 *
 * Reviewers must reach the official contact before withdrawing a business
 * account. Email is sent through the configured bridge; phone/other means the
 * reviewer records that the conversation happened. Either way the attempt is
 * timestamped and audited before a demotion is allowed.
 */
const contactBusinessVerification = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid business profile.');
    const message = String(req.body?.message || '')
      .trim()
      .slice(0, 1000);
    if (message.length < 5) {
      throw badRequest('Write a message that explains what the business must address.');
    }

    const profile = await BusinessProfile.findById(req.params.id);
    if (!profile) throw notFound('Business profile not found.');

    const owner = await User.findById(profile.userId).select('username email').lean();
    const channel = ['email', 'phone', 'other'].includes(req.body?.channel)
      ? req.body.channel
      : profile.contactMethod || 'email';
    const to = profile.contactEmail || profile.supportEmail || owner?.email || '';

    if (channel === 'email') {
      if (!to) throw badRequest('This business has no contact email on file.');
      await sendBusinessReviewEmail({
        to,
        displayName: profile.displayName,
        message,
        outcome: 'contact',
      });
    }

    // A new message starts a new round: the previous answer cannot stand in
    // for an answer to this one, and the window restarts from this contact.
    profile.reviewContactedAt = new Date();
    profile.reviewRespondedAt = null;
    profile.reviewResponseNote = '';
    await profile.save();

    await BusinessVerificationAudit.create({
      businessProfileId: profile._id,
      actorId: req.user._id,
      status: 'contacted',
      channel,
      note: `${channel} contact: ${auditExcerpt(message)}`.slice(0, AUDIT_EXCERPT_LENGTH),
    });
    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_BUSINESS_CONTACT',
      targetId: profile._id,
      targetModel: 'BusinessProfile',
      metadata: { channel, username: owner?.username || null },
    });

    res.status(200).json({
      contacted: true,
      channel,
      reviewContactedAt: profile.reviewContactedAt,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/account/business-verification/respond
 *
 * The owner answers the reviewer's contact from inside the app. Without this,
 * "contact before demotion" would depend on an email reply nobody records.
 */
const respondToBusinessReview = async (req, res, next) => {
  try {
    const parsed = sanitizeReviewResponse(req.body || {});
    if (!parsed.ok) throw badRequest(parsed.reason);

    const profile = await BusinessProfile.findOne({ userId: req.user._id });
    if (!profile) throw notFound('Business profile not found.');
    if (!profile.reviewContactedAt) {
      throw badRequest('There is no review contact to answer yet.');
    }
    // A verified business can also be contacted ahead of a demotion decision,
    // so "pending" is not the only status that may answer.
    if (!['pending', 'verified'].includes(profile.verificationStatus)) {
      throw badRequest('This review is not awaiting a response.');
    }

    profile.reviewRespondedAt = new Date();
    profile.reviewResponseNote = parsed.value;
    await profile.save();

    await BusinessVerificationAudit.create({
      businessProfileId: profile._id,
      actorId: req.user._id,
      status: 'responded',
      channel: profile.contactMethod || 'email',
      note: auditExcerpt(parsed.value),
    });
    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_BUSINESS_RESPOND',
      targetId: profile._id,
      targetModel: 'BusinessProfile',
      metadata: { username: req.user.username || null },
    });

    res.status(200).json({
      responded: true,
      businessProfile: ownerBusinessProfile(profile),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/business-verifications/:id/demote
 *
 * Returns the account to a personal profile and cancels every permission the
 * business role carried: the verified badge, cold outreach and the shared team
 * inbox. A contact attempt logged after the current review request is required
 * first, so a false-information decision cannot skip talking to the business.
 */
const demoteBusinessAccount = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw badRequest('Invalid business profile.');
    const reason = String(req.body?.reason || '')
      .trim()
      .slice(0, 500);
    if (reason.length < 5) {
      throw badRequest('Give a reason (at least 5 characters) for the demotion.');
    }

    const profile = await BusinessProfile.findById(req.params.id);
    if (!profile) throw notFound('Business profile not found.');

    const readiness = demotionReadiness(profile);
    if (!readiness.ok) {
      throw conflict(readiness.reason, { code: readiness.code });
    }

    const owner = await User.findById(profile.userId).select('username email').lean();
    const to = profile.contactEmail || profile.supportEmail || owner?.email || '';

    await User.updateOne({ _id: profile.userId }, { $set: { profileType: 'personal' } });

    profile.verificationStatus = 'none';
    profile.verificationMethod = null;
    profile.verificationDomain = '';
    profile.verificationToken = '';
    profile.verifiedAt = null;
    profile.verifiedBy = null;
    profile.outreachPaused = false;
    profile.reviewDecidedAt = new Date();
    profile.demotedAt = new Date();
    profile.demotionReason = reason;
    await profile.save();

    // Team access exists only for the business workspace; remove it with the
    // role. API checks re-read membership, so a removed teammate loses access
    // immediately even before their open socket is closed.
    const revoked = await BusinessTeamMember.updateMany(
      { businessOwnerId: profile.userId, status: { $ne: 'removed' } },
      { $set: { status: 'removed', respondedAt: new Date() } },
    );

    await BusinessVerificationAudit.create({
      businessProfileId: profile._id,
      actorId: req.user._id,
      status: 'demoted',
      channel: profile.contactMethod || 'email',
      note: reason,
    });
    await recordPlatformAudit({
      actorId: req.user._id,
      actionType: 'PLATFORM_BUSINESS_DEMOTE',
      targetId: profile._id,
      targetModel: 'BusinessProfile',
      metadata: {
        reason,
        username: owner?.username || null,
        revokedTeamMembers: revoked.modifiedCount || 0,
      },
    });

    if (to) {
      sendBusinessReviewEmail({
        to,
        displayName: profile.displayName,
        message: reason,
        outcome: 'demoted',
      }).catch((err) => console.error('[Business] demotion email failed:', err.message));
    }

    res.status(200).json({
      demoted: true,
      revokedTeamMembers: revoked.modifiedCount || 0,
      businessProfile: ownerBusinessProfile(profile),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPublicBusiness,
  saveBusinessProfile,
  downgradeBusiness,
  requestBusinessVerification,
  checkBusinessVerification,
  getBusinessAnalytics,
  getPendingBusinessVerifications,
  resolveBusinessVerification,
  contactBusinessVerification,
  respondToBusinessReview,
  demoteBusinessAccount,
};
