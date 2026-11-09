const crypto = require('crypto');

const BusinessProfile = require('../models/BusinessProfile');
const BusinessVerificationAudit = require('../models/BusinessVerificationAudit');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

const { badRequest, notFound, conflict } = require('../utils/httpError');
const {
  BUSINESS_VERIFICATION_METHODS,
  sanitizeBusinessProfile,
  publicBusinessProfile,
  verificationDomainFor
} = require('../utils/business');
const { checkDnsToken, normalizeDomain } = require('../utils/domainVerification');

const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));

/** GET /api/business/:username — public disclosed business card. */
const getPublicBusiness = async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('username level role profileType status followers')
      .lean();
    if (!user || user.profileType !== 'creator_business') throw notFound('Business not found.');
    if (['frozen', 'suspended', 'deleted', 'deletion_pending'].includes(user.status)) {
      throw notFound('Business not found.');
    }

    const profile = await BusinessProfile.findOne({ userId: user._id }).lean();
    if (!profile) throw notFound('Business not found.');

    res.status(200).json({
      username: user.username,
      level: user.level || 1,
      role: user.role || 'user',
      profileType: 'creator_business',
      followerCount: (user.followers || []).length,
      business: publicBusinessProfile(profile)
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
        verifiedBy: null
      });
    }

    const profile = await BusinessProfile.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update, $setOnInsert: { userId: req.user._id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    await User.updateOne({ _id: req.user._id }, { $set: { profileType: 'creator_business' } });

    res.status(200).json({
      profileType: 'creator_business',
      businessProfile: {
        ...publicBusinessProfile(profile),
        verificationMethod: profile.verificationMethod || null,
        verificationDomain: profile.verificationDomain || '',
        verificationRequestedAt: profile.verificationRequestedAt || null
      }
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
        businessProfile: publicBusinessProfile(profile),
        alreadyVerified: true
      });
    }

    const method = BUSINESS_VERIFICATION_METHODS.includes(req.body?.method)
      ? req.body.method
      : 'dns';
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
    await profile.save();

    res.status(200).json({
      businessProfile: {
        ...publicBusinessProfile(profile),
        verificationMethod: profile.verificationMethod,
        verificationDomain: profile.verificationDomain,
        verificationRequestedAt: profile.verificationRequestedAt
      },
      instructions: method === 'dns'
        ? {
            method,
            domain,
            recordName: `_gamerhub-verify.${domain}`,
            recordType: 'TXT',
            recordValue: `gamerhub-verify=${token}`
          }
        : {
            method,
            message: 'An administrator will review your business details manually.'
          }
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
      return res.status(200).json({ businessProfile: publicBusinessProfile(profile), alreadyVerified: true });
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
    profile.outreachPaused = false;
    profile.verificationToken = '';
    await profile.save();

    await BusinessVerificationAudit.create({
      businessProfileId: profile._id,
      actorId: null,
      status: 'verified',
      note: `Automatic DNS match for ${result.recordName}`
    });

    res.status(200).json({
      businessProfile: publicBusinessProfile(profile),
      verified: true,
      domain: result.domain
    });
  } catch (err) {
    next(err);
  }
};

/** GET /api/account/business/analytics — owner-only outreach counters. */
const getBusinessAnalytics = async (req, res, next) => {
  try {
    const profile = await BusinessProfile.findOne({ userId: req.user._id }).select('verificationStatus outreachPaused complaints').lean();
    if (!profile) throw notFound('Business profile not found.');

    const [sent, accepted, active] = await Promise.all([
      Conversation.countDocuments({
        initiatorId: req.user._id,
        requestIntent: { $ne: null }
      }),
      Conversation.countDocuments({
        initiatorId: req.user._id,
        requestIntent: { $ne: null },
        state: 'active'
      }),
      Conversation.countDocuments({
        participantIds: req.user._id,
        state: 'active',
        businessThread: true
      })
    ]);

    res.status(200).json({
      verificationStatus: profile.verificationStatus,
      outreachPaused: Boolean(profile.outreachPaused),
      complaints: profile.complaints || 0,
      sent,
      accepted,
      active,
      acceptanceRate: sent ? Math.round((accepted / sent) * 100) : null
    });
  } catch (err) {
    next(err);
  }
};

/** GET /api/admin/business-verifications */
const getPendingBusinessVerifications = async (req, res, next) => {
  try {
    const status = ['pending', 'verified', 'rejected', 'all'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const query = status === 'all'
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
      items: profiles.map((profile) => ({
        _id: String(profile._id),
        user: profile.userId
          ? {
              _id: String(profile.userId._id),
              username: profile.userId.username,
              email: profile.userId.email,
              status: profile.userId.status
            }
          : null,
        business: {
          ...publicBusinessProfile(profile),
          verificationMethod: profile.verificationMethod || null,
          verificationDomain: profile.verificationDomain || ''
        },
        token: profile.verificationToken || '',
        requestedAt: profile.verificationRequestedAt || null
      }))
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
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const profile = await BusinessProfile.findById(req.params.id);
    if (!profile) throw notFound('Business profile not found.');
    if (profile.verificationStatus === 'verified' && status === 'verified') {
      // A verified business can be paused by the complaint signal. The same
      // admin action doubles as the recovery path once the reports are reviewed.
      profile.outreachPaused = false;
      await profile.save();
      return res.status(200).json({
        businessProfile: publicBusinessProfile(profile),
        status: 'verified',
        unpaused: true
      });
    }

    profile.verificationStatus = status;
    profile.verifiedAt = status === 'verified' ? new Date() : null;
    profile.verifiedBy = status === 'verified' ? req.user._id : null;
    if (status === 'verified') profile.outreachPaused = false;
    if (status === 'rejected') profile.verificationToken = '';
    await profile.save();

    await BusinessVerificationAudit.create({
      businessProfileId: profile._id,
      actorId: req.user._id,
      status,
      note
    });

    res.status(200).json({
      businessProfile: publicBusinessProfile(profile),
      status
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
  resolveBusinessVerification
};
