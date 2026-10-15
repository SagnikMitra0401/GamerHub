import React, { useState, useEffect, useRef, useCallback } from 'react';
import axiosInstance from '../../api/axiosInstance';
import ConfirmModal from '../common/ConfirmModal';
import LinkPreviewCard from './LinkPreviewCard';

const COMMON_TAGS = ['FPS', 'RPG', 'MOBA', 'Battle Royale', 'Strategy', 'Sports', 'Horror', 'Co-op'];

// Detect any URL (with or without https://) in a block of text
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s"'<>]+|(?<!\w)[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s]*/i;

const PostForm = ({ onSuccess, initialData = null, onCancel }) => {
  const editing = !!initialData;

  const [form, setForm] = useState({
    title:   initialData?.title   || '',
    content: initialData?.content || '',
    tags:    initialData?.tags?.join(', ') || ''
  });
  const [file, setFile]               = useState(null);
  const [filePreview, setFilePreview] = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Link-preview states
  const [linkPreview, setLinkPreview]       = useState(null);   // scraped preview object
  const [previewLoading, setPreviewLoading] = useState(false);   // spinner in form
  const [previewDismissed, setPreviewDismissed] = useState(false); // user hid it
  const [lastScrapedUrl, setLastScrapedUrl] = useState('');      // avoid re-fetching same url
  const debounceRef = useRef(null);

  const handleChange = e => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // ── Live preview detection ──────────────────────────────────────────────────
  const fetchPreview = useCallback(async (text) => {
    const match = text.match(URL_PATTERN);
    if (!match) {
      setLinkPreview(null);
      setLastScrapedUrl('');
      return;
    }

    let raw = match[0];
    // Normalise: add https:// if missing
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

    // Avoid re-fetching the same URL
    if (raw === lastScrapedUrl) return;

    setLastScrapedUrl(raw);
    setPreviewDismissed(false);
    setPreviewLoading(true);
    setLinkPreview(null);

    try {
      const { data } = await axiosInstance.get(`/posts/preview?url=${encodeURIComponent(raw)}`);
      setLinkPreview(data);
    } catch {
      setLinkPreview(null); // fail silently — don't block composing
    } finally {
      setPreviewLoading(false);
    }
  }, [lastScrapedUrl]);

  // Debounce: trigger 600ms after the user stops typing
  useEffect(() => {
    if (editing) return; // no live preview in edit mode (edit is text-only)
    const combined = [form.title, form.content].join(' ');

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(combined), 600);

    return () => clearTimeout(debounceRef.current);
  }, [form.title, form.content, editing, fetchPreview]);

  // ── Dirty check ─────────────────────────────────────────────────────────────
  const isDirty = () => {
    const titleChanged   = form.title.trim()   !== (initialData?.title   || '');
    const contentChanged = form.content.trim() !== (initialData?.content || '');
    const tagsChanged    = form.tags.split(',').map(t => t.trim()).filter(Boolean).join(',') !==
                           (initialData?.tags || []).join(',');
    return titleChanged || contentChanged || tagsChanged || !!file;
  };

  const handleCancelClick = () => {
    if (isDirty()) setShowCancelConfirm(true);
    else onCancel?.();
  };

  // ── File selection ──────────────────────────────────────────────────────────
  const handleFileChange = e => {
    setError('');
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    const isVideo = selectedFile.type.startsWith('video/');
    const isImage = selectedFile.type.startsWith('image/');
    if (!isVideo && !isImage) {
      setError('Invalid file type. Please select an image or a video clip.');
      return;
    }

    const maxSize = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError(isVideo ? 'Video clips must be 10MB or less.' : 'Images must be 5MB or less.');
      return;
    }

    setFile(selectedFile);
    setFilePreview(URL.createObjectURL(selectedFile));
  };

  const clearFile = () => {
    setFile(null);
    if (filePreview) { URL.revokeObjectURL(filePreview); setFilePreview(''); }
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const tagsArray = form.tags.split(',').map(t => t.trim()).filter(Boolean);

      if (editing) {
        const { data } = await axiosInstance.put(`/posts/${initialData._id}`, {
          title:   form.title.trim(),
          content: form.content.trim(),
          tags:    tagsArray,
        });
        onSuccess(data);
      } else {
        const formData = new FormData();
        formData.append('title',   form.title.trim());
        formData.append('content', form.content.trim());
        formData.append('tags',    JSON.stringify(tagsArray));
        if (file) formData.append('media', file);

        // Pass the already-fetched preview to avoid a slow re-scrape on the server
        const previewToSend = !previewDismissed && linkPreview ? linkPreview : null;
        if (previewToSend) {
          formData.append('linkPreview', JSON.stringify(previewToSend));
        }

        const { data } = await axiosInstance.post('/posts', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        onSuccess(data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong while saving the post.');
    } finally {
      setLoading(false);
    }
  };

  const addTag = tag => {
    const existing = form.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (!existing.includes(tag.toLowerCase())) {
      setForm({ ...form, tags: [...existing, tag].join(', ') });
    }
  };

  const showPreviewBlock = !editing && (previewLoading || (!previewDismissed && linkPreview));

  return (
    <div className="post-form-card">
      <h3 className="post-form-title">{editing ? '✏️ Edit Post' : '✍️ Share a Moment'}</h3>
      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Title */}
        <div className="form-group">
          <label className="form-label" htmlFor="post-title">Title</label>
          <input
            id="post-title"
            className="form-input"
            name="title"
            placeholder="What's on your mind? Or paste a link to preview it..."
            value={form.title}
            onChange={handleChange}
            required
          />
        </div>

        {/* Description */}
        <div className="form-group">
          <label className="form-label" htmlFor="post-content">Description (Optional)</label>
          <textarea
            id="post-content"
            className="form-textarea"
            name="content"
            placeholder="Describe your clip, share a URL for a preview card, or start a discussion..."
            value={form.content}
            onChange={handleChange}
          />
        </div>

        {/* ── Live Link Preview Block ─────────────────────────────────────── */}
        {showPreviewBlock && (
          <div className="form-group">
            {previewLoading && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.8rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '14px',
                    height: '14px',
                    border: '2px solid var(--primary)',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                  }}
                />
                Fetching link preview…
              </div>
            )}

            {!previewLoading && linkPreview && (
              <LinkPreviewCard
                preview={linkPreview}
                onDismiss={() => { setPreviewDismissed(true); setLinkPreview(null); }}
                clickable={false}
              />
            )}
          </div>
        )}

        {/* Media Upload (create mode only) */}
        {!editing && (
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Upload Clip / Image</label>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', cursor: 'pointer' }}>
                📁 Select File
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
              <span className="text-muted" style={{ fontSize: '0.78rem' }}>
                Max size: 10MB Video, 5MB Image.
              </span>
            </div>

            {filePreview && (
              <div style={{ marginTop: '1rem', position: 'relative', display: 'inline-block' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={clearFile}
                  style={{
                    position: 'absolute', top: '8px', right: '8px', zIndex: 10,
                    borderRadius: '50%', width: '28px', height: '28px', padding: 0,
                    minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                  title="Remove media"
                >✕</button>
                {file.type.startsWith('video/') ? (
                  <video src={filePreview} controls style={{ maxHeight: '200px', maxWidth: '100%', borderRadius: 'var(--radius-sm)' }} />
                ) : (
                  <img src={filePreview} alt="Preview" style={{ maxHeight: '200px', maxWidth: '100%', borderRadius: 'var(--radius-sm)', objectFit: 'contain' }} />
                )}
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        <div className="form-group">
          <label className="form-label" htmlFor="post-tags">Tags (comma separated)</label>
          <input
            id="post-tags"
            className="form-input"
            name="tags"
            placeholder="RPG, Elden Ring, Co-op"
            value={form.tags}
            onChange={handleChange}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
            {COMMON_TAGS.map(tag => (
              <button key={tag} type="button" className="tag" style={{ cursor: 'pointer' }}
                onClick={() => addTag(tag)}>+ {tag}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={handleCancelClick}>Cancel</button>
          )}
          <button id="post-submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Uploading & Saving…' : editing ? 'Save Changes' : 'Publish Post'}
          </button>
        </div>
      </form>

      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Discard changes?"
        message="Are you sure you want to discard your changes? Unsaved modifications will be permanently lost."
        confirmText="Discard"
        cancelText="Keep Editing"
        isDanger={true}
        onConfirm={() => { setShowCancelConfirm(false); onCancel?.(); }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </div>
  );
};

export default PostForm;
