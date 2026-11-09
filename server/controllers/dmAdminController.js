const mongoose = require('mongoose');

const DmReport = require('../models/DmReport');
const DirectMessage = require('../models/DirectMessage');
const DmModerationAudit = require('../models/DmModerationAudit');
const { badRequest, notFound } = require('../utils/httpError');
const { sanitizeLine } = require('../utils/sanitize');

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const STATUSES = ['reviewed', 'actioned', 'dismissed'];

const publicMessage = (message) => ({
  _id: String(message._id),
  text: message.text,
  createdAt: message.createdAt
});

/** GET /api/admin/dm-reports?status=open|reviewed|actioned|dismissed|all */
const getDmReports = async (req, res, next) => {
  try {
    const status = String(req.query.status || 'open');
    if (status !== 'all' && !['open', ...STATUSES].includes(status)) {
      throw badRequest('Unknown report status.');
    }

    const reports = await DmReport.find(status === 'all' ? {} : { status })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('reporterId', 'username')
      .populate('reportedUserId', 'username')
      .lean();

    const messageIds = reports.flatMap((report) => (report.messageIds || []).map(String));
    const messages = messageIds.length
      ? await DirectMessage.find({ _id: { $in: messageIds } })
          .select('_id text createdAt')
          .lean()
      : [];
    const messagesById = new Map(messages.map((message) => [String(message._id), message]));

    res.status(200).json({
      items: reports.map((report) => ({
        _id: String(report._id),
        conversationId: String(report.conversationId),
        reporter: report.reporterId?.username
          ? { _id: String(report.reporterId._id), username: report.reporterId.username }
          : null,
        reported: report.reportedUserId?.username
          ? { _id: String(report.reportedUserId._id), username: report.reportedUserId.username }
          : null,
        reason: report.reason,
        note: report.note || '',
        status: report.status,
        reviewedAt: report.reviewedAt || null,
        createdAt: report.createdAt,
        // Only the messages the reporter selected, never the rest of the thread.
        messages: (report.messageIds || [])
          .map((id) => messagesById.get(String(id)))
          .filter(Boolean)
          .map(publicMessage)
      }))
    });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/dm-reports/:id/resolve */
const resolveDmReport = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw notFound('Report not found.');
    const status = String(req.body?.status || '');
    if (!STATUSES.includes(status)) throw badRequest('Choose reviewed, actioned or dismissed.');

    const note = sanitizeLine(String(req.body?.note || ''), 500);
    const report = await DmReport.findById(req.params.id);
    if (!report) throw notFound('Report not found.');

    report.status = status;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    report.reviewNote = note;
    await report.save();

    const audit = await DmModerationAudit.create({
      reportId: report._id,
      actorId: req.user._id,
      status,
      note
    });

    res.status(200).json({
      report: {
        _id: String(report._id),
        status: report.status,
        reviewedAt: report.reviewedAt,
        reviewNote: report.reviewNote
      },
      audit: {
        _id: String(audit._id),
        status: audit.status,
        createdAt: audit.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getDmReports, resolveDmReport };
