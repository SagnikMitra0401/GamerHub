import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import SafeImage from '../components/common/SafeImage';
import { videoPosterUrl } from '../utils/videoPoster';
import { getSocket } from '../api/socket';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const timeAgo = (value) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

/**
 * One broadcast channel.
 *
 * Owners publish from the composer; subscribers get a read-only feed, unread
 * clearing, mute and a live socket room joined through a server-side
 * membership check.
 */
const ChannelPage = () => {
  const { slug } = useParams();
  const { user } = useAuth();
  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get(`/channels/${slug}`);
      setChannel(data);
      const messagesResponse = await axiosInstance.get(`/channels/${slug}/messages`);
      setMessages(Array.isArray(messagesResponse.data?.items) ? messagesResponse.data.items : []);
      setNextBefore(messagesResponse.data?.nextBefore || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not open that channel.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // Live posts for this channel, only after the server accepts the join.
  useEffect(() => {
    if (!channel?._id) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const onMessage = (payload) => {
      if (payload.channelId !== channel._id) return;
      setMessages((previous) => (
        previous.some((message) => message._id === payload._id) ? previous : [payload, ...previous]
      ));
    };

    socket.emit('join_broadcast', { channelId: channel._id });
    socket.on('broadcast_message', onMessage);
    return () => {
      socket.off('broadcast_message', onMessage);
      socket.emit('leave_broadcast', { channelId: channel._id });
    };
  }, [channel?._id]);

  const toggleSubscription = async () => {
    if (!user || !channel) return;
    setBusy(true);
    try {
      if (channel.isSubscribed) {
        await axiosInstance.delete(`/channels/${channel.slug}/subscribe`);
      } else {
        await axiosInstance.post(`/channels/${channel.slug}/subscribe`);
      }
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update your subscription.');
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = async () => {
    if (!channel?.isSubscribed) return;
    try {
      const { data } = await axiosInstance.patch(`/channels/${channel.slug}/subscription`, {
        muted: !channel.muted
      });
      setChannel({ ...channel, muted: data.muted });
    } catch {
      // Non-critical; the next load re-reads the real state.
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/channels/${channel.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: channel.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // The user dismissed the share sheet.
    }
  };

  const loadMore = async () => {
    if (!nextBefore) return;
    const { data } = await axiosInstance.get(`/channels/${slug}/messages`, { params: { before: nextBefore } });
    setMessages((previous) => [...previous, ...(data.items || [])]);
    setNextBefore(data.nextBefore || null);
  };

  const pickFile = (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const isVideo = selected.type.startsWith('video/');
    if (!isVideo && !selected.type.startsWith('image/')) {
      setComposerError('Choose an image or a video.');
      return;
    }
    if (selected.size > (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
      setComposerError(isVideo ? 'Videos must be 50MB or less.' : 'Images must be 5MB or less.');
      return;
    }
    setComposerError('');
    setFile(selected);
  };

  const publish = async (event) => {
    event.preventDefault();
    if (!text.trim() && !file) { setComposerError('Write something or attach media.'); return; }
    setSending(true);
    setComposerError('');
    try {
      const formData = new FormData();
      formData.append('text', text.trim());
      if (file) formData.append('media', file);

      const { data } = await axiosInstance.post(`/channels/${slug}/messages`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setMessages((previous) => (
        previous.some((message) => message._id === data._id) ? previous : [data, ...previous]
      ));
      setText('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setComposerError(err.response?.data?.message || 'Could not publish that post.');
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (messageId) => {
    try {
      await axiosInstance.delete(`/channels/${slug}/messages/${messageId}`);
      setMessages((previous) => previous.filter((message) => message._id !== messageId));
    } catch (err) {
      setComposerError(err.response?.data?.message || 'Could not delete that post.');
    }
  };

  if (loading) {
    return <main className="container channels-layout"><div className="channels-empty">Loading channel…</div></main>;
  }

  if (error || !channel) {
    return (
      <main className="container channels-layout">
        <div className="channels-empty">
          {error || 'Channel not found.'}{' '}
          <Link to="/channels">Back to channels</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container channels-layout">
      <header className="channel-hero">
        <span className="channel-avatar">
          {channel.avatarUrl ? <SafeImage src={channel.avatarUrl} alt="" /> : (channel.name?.[0]?.toUpperCase() || '#')}
        </span>
        <div className="channel-hero-body">
          <h1>{channel.name}</h1>
          <span className="channel-slug">@{channel.slug} · {channel.category}</span>
          <p>{channel.description || 'A one-way channel for updates.'}</p>
          <div className="channel-card-meta">
            <span>{channel.subscriberCount} subscriber{channel.subscriberCount === 1 ? '' : 's'}</span>
            <span>{channel.messageCount} post{channel.messageCount === 1 ? '' : 's'}</span>
            {!channel.isPublic && <span>Private</span>}
          </div>
        </div>
        <div className="channel-hero-actions">
          {user && !channel.isOwner && (
            <button type="button" className={`btn ${channel.isSubscribed ? 'btn-ghost' : 'btn-primary'}`} onClick={toggleSubscription} disabled={busy}>
              {channel.isSubscribed ? 'Unsubscribe' : 'Follow'}
            </button>
          )}
          {channel.isSubscribed && (
            <button type="button" className="btn btn-ghost" onClick={toggleMute}>
              {channel.muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={share}>
            {copied ? 'Link copied' : 'Share'}
          </button>
        </div>
      </header>

      {channel.canPublish && (
        <form className="broadcast-composer" onSubmit={publish}>
          <span className="broadcast-badge">Broadcast</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            placeholder="Write an update for your subscribers…"
            aria-label="Broadcast text"
          />
          {composerError && <div className="form-error">{composerError}</div>}
          <div className="broadcast-composer-row">
            <div className="story-sheet-row">
              <input
                ref={fileRef}
                id="broadcast-media"
                type="file"
                accept="image/*,video/*"
                onChange={pickFile}
                className="story-file-input"
              />
              <label htmlFor="broadcast-media" className="btn btn-ghost btn-sm">Attach</label>
              {file && <span className="broadcast-composer-meta">{file.name}</span>}
              <span className="broadcast-composer-meta">Image ≤ 5MB · Video ≤ 50MB</span>
            </div>
            <button type="submit" className="btn btn-primary" disabled={sending}>
              {sending ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </form>
      )}

      <section className="broadcast-feed">
        {messages.length === 0 ? (
          <div className="broadcast-empty">
            {channel.canPublish ? 'Publish your first update above.' : 'No posts here yet.'}
          </div>
        ) : (
          messages.map((message) => (
            <article className="broadcast-post" key={message._id}>
              <div className="broadcast-post-head">
                <span className="broadcast-badge">Broadcast</span>
                <span>{message.author?.username || channel.name} · {timeAgo(message.publishedAt)}</span>
              </div>
              {message.text && <p className="broadcast-post-text">{message.text}</p>}
              {message.mediaType === 'image' && message.mediaUrl && (
                <SafeImage src={message.mediaUrl} alt="" className="broadcast-post-media" />
              )}
              {message.mediaType === 'video' && message.mediaUrl && (
                <video
                  src={message.mediaUrl}
                  poster={videoPosterUrl(message.mediaUrl) || undefined}
                  className="broadcast-post-media"
                  controls
                  playsInline
                  preload="metadata"
                />
              )}
              {channel.canPublish && (
                <div className="broadcast-post-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => deleteMessage(message._id)}>
                    Delete
                  </button>
                </div>
              )}
            </article>
          ))
        )}

        {nextBefore && (
          <div style={{ textAlign: 'center' }}>
            <button type="button" className="btn btn-ghost" onClick={loadMore}>Load older posts</button>
          </div>
        )}
      </section>
    </main>
  );
};

export default ChannelPage;
