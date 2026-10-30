import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import { TrashIcon, PinIcon, ReplyIcon, AlertIcon, CloseIcon } from '../common/icons';
import { CAP, ROLE_COLORS, ROLE_LABELS, hasCapability } from '../../utils/permissions';
import { QUICK_REACTIONS, reactionGlyph, reactionLabel } from '../../utils/reactions';

const timeAgo = (date) => {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
};

/**
 * Attachment preview.
 * The URL is fetched per render with the caller's session, so a URL copied out
 * of the DOM by someone else is useless — the server re-authorises each request
 * and hands back a short-lived signed link.
 */
const AttachmentThumb = ({ attachment, channelId }) => {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!attachment?._id) return undefined;

    axiosInstance
      .get(`/communities/channels/${channelId}/attachments/${attachment._id}`)
      .then(({ data }) => { if (!cancelled) setUrl(data.url); })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
  }, [attachment?._id, channelId]);

  if (failed) return null;

  return (
    <a
      className="chat-attachment"
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => { if (!url) event.preventDefault(); }}
      aria-label="Open attached image"
    >
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="chat-attachment-skeleton" />}
    </a>
  );
};

/** Highlight only the mentions the server actually resolved. */
const renderWithMentions = (text, mentions = []) => {
  const known = new Set(mentions.map((mention) => String(mention.username).toLowerCase()));
  const parts = String(text).split(/(@[a-zA-Z0-9_]{3,20})/g);

  return parts.map((part, index) => {
    if (!part.startsWith('@')) return part;
    const name = part.slice(1).toLowerCase();
    if (name === 'everyone') {
      return <span key={index} className="chat-mention chat-mention-everyone">{part}</span>;
    }
    if (known.has(name)) return <span key={index} className="chat-mention">{part}</span>;
    return part;
  });
};

const MessageItem = ({
  message,
  channelId,
  me,
  permissions = [],
  communityRole,
  canWrite = false,
  onDelete,
  onReply,
  onReact,
  onPin,
  onReport
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  const sender = message.senderId || {};
  const isAuthor = me && String(sender._id) === String(me._id);
  const canDelete = !message.isDeleted
    && (isAuthor || hasCapability(permissions, CAP.MANAGE_MESSAGES));
  const canPin = !message.isDeleted && hasCapability(permissions, CAP.PIN_MESSAGES);
  const canReact = !message.isDeleted && hasCapability(permissions, CAP.ADD_REACTIONS);
  const canReport = !message.isDeleted && !isAuthor;
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];

  return (
    <div
      className={`chat-message${message.isDeleted ? ' deleted' : ''}${isAuthor ? ' own' : ''}`}
      data-message-id={message._id}
    >
      <div className="chat-avatar">{sender.username?.[0]?.toUpperCase() || '?'}</div>

      <div className="chat-message-body">
        <div className="chat-message-header">
          <Link to={`/u/${sender.username || ''}`} className="chat-sender-name">
            {sender.username || 'Unknown'}
          </Link>
          {sender.level && <span className="level-badge" style={{ fontSize: '0.65rem' }}>Lv{sender.level}</span>}
          {communityRole && communityRole !== 'member' && (
            <span style={{ fontSize: '0.68rem', color: ROLE_COLORS[communityRole] }}>
              {ROLE_LABELS[communityRole]}
            </span>
          )}
          <span className="chat-timestamp">{timeAgo(message.createdAt)}</span>
          {message.isEdited && !message.isDeleted && <span className="chat-edited">(edited)</span>}
          {message.pinned && !message.isDeleted && (
            <span className="chat-pinned-flag" title="Pinned"><PinIcon size={11} /> pinned</span>
          )}

          <div className="chat-msg-actions">
            {canWrite && !message.isDeleted && (
              <button
                type="button"
                className="chat-msg-action"
                title="Reply"
                aria-label="Reply to this message"
                onClick={() => onReply?.(message)}
              >
                <ReplyIcon size={13} />
              </button>
            )}
            {canReact && (
              <button
                type="button"
                className={`chat-msg-action${pickerOpen ? ' active' : ''}`}
                title="Add reaction"
                aria-label="Add reaction"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen(open => !open)}
              >
                {pickerOpen ? <CloseIcon size={13} /> : <span className="chat-msg-react-plus">+</span>}
              </button>
            )}
            {canPin && (
              <button
                type="button"
                className={`chat-msg-action${message.pinned ? ' active' : ''}`}
                title={message.pinned ? 'Unpin message' : 'Pin message'}
                aria-label={message.pinned ? 'Unpin message' : 'Pin message'}
                onClick={() => onPin?.(message)}
              >
                <PinIcon size={13} />
              </button>
            )}
            {canReport && (
              <button
                type="button"
                className="chat-msg-action"
                title="Report to moderators"
                aria-label="Report message"
                onClick={() => onReport?.(message)}
              >
                <AlertIcon size={13} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="chat-msg-action danger"
                title="Delete message"
                aria-label="Delete message"
                onClick={() => onDelete?.(message._id)}
              >
                <TrashIcon size={13} />
              </button>
            )}
          </div>
        </div>

        {message.replyTo?.messageId && !message.isDeleted && (
          <div className="chat-reply-context">
            <ReplyIcon size={11} />
            <span className="chat-reply-name">{message.replyTo.senderName || 'someone'}</span>
            <span className="chat-reply-preview">{message.replyTo.preview || '[deleted]'}</span>
          </div>
        )}

        {message.text ? (
          <p className={`chat-message-text${message.isDeleted ? ' text-tombstone' : ''}`}>
            {message.isDeleted
              ? 'This message was deleted'
              : renderWithMentions(message.text, message.mentions)}
          </p>
        ) : message.isDeleted ? (
          <p className="chat-message-text text-tombstone">This message was deleted</p>
        ) : null}

        {Array.isArray(message.attachments) && message.attachments.length > 0 && !message.isDeleted && (
          <div className="chat-attachments">
            {message.attachments.map((attachment) => (
              <AttachmentThumb
                key={attachment._id || attachment}
                attachment={attachment}
                channelId={channelId}
              />
            ))}
          </div>
        )}

        {canReact && pickerOpen && (
          <div className="chat-reaction-picker" role="group" aria-label="Choose a reaction">
            {QUICK_REACTIONS.map((code) => (
              <button
                key={code}
                type="button"
                className="chat-reaction-option"
                title={reactionLabel(code)}
                aria-label={`React with ${reactionLabel(code)}`}
                onClick={() => { onReact?.(message, code); setPickerOpen(false); }}
              >
                {reactionGlyph(code)}
              </button>
            ))}
          </div>
        )}

        {reactions.length > 0 && !message.isDeleted && (
          <div className="chat-reactions">
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={`chat-reaction${reaction.mine ? ' mine' : ''}`}
                disabled={!canReact}
                title={reactionLabel(reaction.emoji)}
                aria-pressed={!!reaction.mine}
                onClick={() => onReact?.(message, reaction.emoji)}
              >
                <span className="chat-reaction-glyph">{reactionGlyph(reaction.emoji)}</span>
                <span className="chat-reaction-count">{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageItem;
