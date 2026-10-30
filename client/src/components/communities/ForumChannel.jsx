import React, { useCallback, useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { CAP, hasCapability } from '../../utils/permissions';
import { AlertIcon, ArrowLeftIcon, CommentIcon, LockIcon, PlusIcon, TrashIcon } from '../common/icons';

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'answered', label: 'Answered' },
  { key: 'locked', label: 'Locked' },
  { key: 'archived', label: 'Archived' }
];

const STATUS_LABEL = { open: 'Open', answered: 'Answered', locked: 'Locked', archived: 'Archived' };

const timeAgo = (date) => {
  if (!date) return '';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
};

/**
 * Forum channel surface.
 *
 * Three views live in one component because they share the same data source and
 * the same permission rules: the thread list, the "new thread" form, and a
 * thread with its replies. The server enforces every rule; this only decides
 * what is worth showing.
 */
const ForumChannel = ({ communityId, channel, permissions = [], canWrite, onNotice }) => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');

  const [view, setView] = useState('list'); // 'list' | 'create' | 'thread'
  const [activePostId, setActivePostId] = useState(null);

  const [draft, setDraft] = useState({ title: '', body: '', tags: '' });
  const [saving, setSaving] = useState(false);

  const [thread, setThread] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyDraft, setReplyDraft] = useState('');

  const canCreate = canWrite && hasCapability(permissions, CAP.CREATE_FORUM_POSTS);
  const canReply = canWrite && hasCapability(permissions, CAP.REPLY_FORUM_POSTS);
  const canManage = hasCapability(permissions, CAP.MANAGE_FORUM_POSTS);

  const base = `/communities/${communityId}/channels/${channel._id}/forum`;

  const report = (message) => {
    setNotice(message);
    onNotice?.(message);
  };

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (query.trim().length >= 2) params.set('q', query.trim());
      const { data } = await axiosInstance.get(`${base}?${params}`);
      setPosts(data.posts || []);
    } catch (err) {
      report(err.response?.data?.message || 'Could not load this forum.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, status, query]);

  useEffect(() => {
    if (view !== 'list') return undefined;
    const timer = setTimeout(loadPosts, 200);
    return () => clearTimeout(timer);
  }, [view, loadPosts]);

  // Reset when the channel changes.
  useEffect(() => {
    setView('list');
    setActivePostId(null);
    setThread(null);
    setReplies([]);
    setDraft({ title: '', body: '', tags: '' });
    setNotice('');
  }, [channel._id]);

  const openThread = async (postId) => {
    setView('thread');
    setActivePostId(postId);
    setThread(null);
    setReplies([]);
    try {
      const { data } = await axiosInstance.get(`${base}/${postId}`);
      setThread(data.post);
      setReplies(data.replies || []);
    } catch (err) {
      report(err.response?.data?.message || 'Could not open that thread.');
    }
  };

  const createPost = async (event) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.body.trim()) return;
    setSaving(true);
    try {
      const { data } = await axiosInstance.post(base, {
        title: draft.title.trim(),
        body: draft.body.trim(),
        tags: draft.tags.split(',').map(tag => tag.trim()).filter(Boolean)
      });
      setDraft({ title: '', body: '', tags: '' });
      setView('list');
      await loadPosts();
      openThread(data._id);
    } catch (err) {
      report(err.response?.data?.message || 'Could not create that post.');
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async (event) => {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!body || !activePostId) return;
    setSaving(true);
    try {
      const { data } = await axiosInstance.post(`${base}/${activePostId}/replies`, { body });
      setReplies(prev => [...prev, data]);
      setReplyDraft('');
    } catch (err) {
      report(err.response?.data?.message || 'Could not post that reply.');
    } finally {
      setSaving(false);
    }
  };

  const setPostStatus = async (nextStatus) => {
    if (!activePostId) return;
    try {
      const { data } = await axiosInstance.patch(`${base}/${activePostId}/status`, { status: nextStatus });
      setThread(prev => (prev ? { ...prev, status: data.status } : prev));
    } catch (err) {
      report(err.response?.data?.message || 'Could not change the status.');
    }
  };

  const deletePost = async () => {
    if (!activePostId) return;
    try {
      await axiosInstance.delete(`${base}/${activePostId}`);
      setView('list');
      setActivePostId(null);
      setThread(null);
      await loadPosts();
    } catch (err) {
      report(err.response?.data?.message || 'Could not delete that post.');
    }
  };

  // ── Thread view ───────────────────────────────────────────────────────────
  if (view === 'thread') {
    const locked = thread && thread.status !== 'open' && thread.status !== 'answered';
    return (
      <div className="forum-surface">
        <div className="forum-toolbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setView('list'); setActivePostId(null); }}>
            <ArrowLeftIcon size={14} /> All threads
          </button>
          {canManage && thread && (
            <div className="forum-toolbar-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPostStatus(locked ? 'open' : 'locked')}>
                <LockIcon size={13} /> {locked ? 'Reopen' : 'Lock'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPostStatus('answered')}>
                Mark answered
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={deletePost}>
                <TrashIcon size={13} /> Delete
              </button>
            </div>
          )}
        </div>

        {notice && <div className="chat-notice" role="status">{notice}</div>}

        {!thread ? (
          <div className="spinner" />
        ) : (
          <>
            <article className="forum-thread">
              <div className="forum-thread-head">
                <h2 className="forum-thread-title">{thread.title}</h2>
                <span className={`forum-status forum-status-${thread.status}`}>{STATUS_LABEL[thread.status]}</span>
              </div>
              <p className="forum-thread-meta">
                {thread.author?.username || 'Unknown'} · {timeAgo(thread.createdAt)} · {thread.replyCount || 0} repl{thread.replyCount === 1 ? 'y' : 'ies'}
              </p>
              {(thread.tags || []).length > 0 && (
                <div className="forum-tags">
                  {thread.tags.map(tag => <span key={tag} className="forum-tag">{tag}</span>)}
                </div>
              )}
              <p className="forum-thread-body">{thread.body}</p>
            </article>

            <div className="forum-replies">
              {replies.map(reply => (
                <div key={reply._id} className={`forum-reply${reply.isDeleted ? ' deleted' : ''}`}>
                  <div className="forum-reply-head">
                    <span className="forum-reply-author">{reply.author?.username || 'Unknown'}</span>
                    <span className="chat-timestamp">{timeAgo(reply.createdAt)}</span>
                    {reply.isEdited && <span className="chat-edited">(edited)</span>}
                  </div>
                  <p className="forum-reply-body">{reply.body}</p>
                </div>
              ))}
              {replies.length === 0 && <p className="text-muted">No replies yet.</p>}
            </div>

            {canReply && !locked ? (
              <form className="forum-reply-form" onSubmit={sendReply}>
                <textarea
                  className="form-textarea"
                  rows={3}
                  maxLength={2000}
                  placeholder="Write a reply…"
                  value={replyDraft}
                  onChange={event => setReplyDraft(event.target.value)}
                  aria-label="Reply"
                />
                <button className="btn btn-primary btn-sm" disabled={saving || !replyDraft.trim()}>
                  {saving ? 'Posting…' : 'Post reply'}
                </button>
              </form>
            ) : locked ? (
              <p className="forum-locked-note"><LockIcon size={13} /> This thread is locked — replies are closed.</p>
            ) : null}
          </>
        )}
      </div>
    );
  }

  // ── Create view ───────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="forum-surface">
        <div className="forum-toolbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('list')}>
            <ArrowLeftIcon size={14} /> Cancel
          </button>
        </div>

        {notice && <div className="chat-notice" role="status">{notice}</div>}

        <form className="forum-form" onSubmit={createPost}>
          <div className="form-group">
            <label className="form-label" htmlFor="forum-title">Title</label>
            <input
              id="forum-title"
              className="form-input"
              maxLength={100}
              value={draft.title}
              onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))}
              placeholder="What do you need help with?"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="forum-body">Body</label>
            <textarea
              id="forum-body"
              className="form-textarea"
              rows={8}
              maxLength={4000}
              value={draft.body}
              onChange={event => setDraft(prev => ({ ...prev, body: event.target.value }))}
              placeholder="Add the details — rank, region, what you have tried…"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="forum-tags">Tags</label>
            <input
              id="forum-tags"
              className="form-input"
              maxLength={140}
              value={draft.tags}
              onChange={event => setDraft(prev => ({ ...prev, tags: event.target.value }))}
              placeholder="comma, separated, tags"
            />
            {(channel.forumConfig?.allowedTags || []).length > 0 && (
              <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                Allowed: {channel.forumConfig.allowedTags.join(', ')}
              </span>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={() => setView('list')}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !draft.title.trim() || !draft.body.trim()}>
              {saving ? 'Posting…' : 'Create thread'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="forum-surface">
      <div className="forum-toolbar">
        <div className="forum-filters">
          {STATUS_FILTERS.map(filter => (
            <button
              key={filter.key || 'all'}
              type="button"
              className={`forum-filter${status === filter.key ? ' active' : ''}`}
              onClick={() => setStatus(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {canCreate && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setView('create')}>
            <PlusIcon size={14} /> New thread
          </button>
        )}
      </div>

      <input
        className="form-input forum-search"
        placeholder="Search threads…"
        value={query}
        maxLength={100}
        onChange={event => setQuery(event.target.value)}
        aria-label="Search threads"
      />

      {notice && <div className="chat-notice" role="status">{notice}</div>}

      {loading ? (
        <div className="spinner" />
      ) : posts.length === 0 ? (
        <div className="forum-empty">
          <AlertIcon size={18} />
          <p>No threads here yet.</p>
          {canCreate && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setView('create')}>
              Start the first thread
            </button>
          )}
        </div>
      ) : (
        <div className="forum-list">
          {posts.map(post => (
            <button
              key={post._id}
              type="button"
              className="forum-row"
              onClick={() => openThread(post._id)}
            >
              <div className="forum-row-main">
                <div className="forum-row-title">
                  <span>{post.title}</span>
                  <span className={`forum-status forum-status-${post.status}`}>{STATUS_LABEL[post.status]}</span>
                </div>
                <div className="forum-row-meta">
                  {post.author?.username || 'Unknown'} · {timeAgo(post.lastReplyAt || post.createdAt)}
                </div>
              </div>
              <div className="forum-row-side">
                {(post.tags || []).slice(0, 2).map(tag => (
                  <span key={tag} className="forum-tag">{tag}</span>
                ))}
                <span className="forum-reply-count"><CommentIcon size={12} /> {post.replyCount || 0}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ForumChannel;
