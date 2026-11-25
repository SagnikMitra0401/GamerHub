import React, { useEffect, useRef, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';

const BACKGROUNDS = [
  { key: 'aurora', label: 'Aurora' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'ocean', label: 'Ocean' },
  { key: 'ember', label: 'Ember' },
  { key: 'forest', label: 'Forest' },
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/**
 * Full-screen composer for a 24-hour status.
 *
 * Text statuses pick a background; media statuses upload through the same
 * pipeline as posts, with the stricter story limits enforced here and again on
 * the server.
 */
const StoryComposer = ({ isOpen, onClose, onCreated }) => {
  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [background, setBackground] = useState('aurora');
  const [visibility, setVisibility] = useState('followers');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, loading, onClose]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!isOpen) return null;

  const reset = () => {
    setMode('text');
    setText('');
    setCaption('');
    setBackground('aurora');
    setVisibility('followers');
    setFile(null);
    setPreview(null);
    setError('');
  };

  const close = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const pickFile = (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const isVideo = selected.type.startsWith('video/');
    const isImage = selected.type.startsWith('image/');
    if (!isVideo && !isImage) {
      setError('Choose an image or a video.');
      return;
    }
    const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (selected.size > limit) {
      setError(isVideo ? 'Videos must be 50MB or less.' : 'Images must be 5MB or less.');
      return;
    }
    setError('');
    setMode(isVideo ? 'video' : 'image');
    setFile(selected);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (mode === 'text' && !text.trim()) {
      setError('Write something for your status.');
      return;
    }
    if (mode !== 'text' && !file) {
      setError('Choose a photo or video first.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('text', mode === 'text' ? text.trim() : '');
      formData.append('caption', caption.trim());
      formData.append('background', background);
      formData.append('visibility', visibility);
      if (file) formData.append('media', file);

      await axiosInstance.post('/stories', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      reset();
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not publish that story.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="story-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Create a story"
    >
      <button
        type="button"
        className="story-sheet-scrim"
        aria-label="Close composer"
        onClick={close}
      />
      <form className="story-sheet" onSubmit={submit}>
        <header className="story-sheet-head">
          <h3>New story</h3>
          <button type="button" className="story-close" onClick={close} aria-label="Close composer">
            ×
          </button>
        </header>

        {error && <div className="form-error">{error}</div>}

        <div className={`story-compose-preview story-bg-${background}`}>
          {mode === 'text' && (
            <textarea
              className="story-compose-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={200}
              placeholder="What's happening?"
              aria-label="Story text"
            />
          )}
          {mode === 'image' && preview && (
            <img src={preview} alt="Story preview" className="story-compose-media" />
          )}
          {mode === 'video' && preview && (
            <video src={preview} className="story-compose-media" controls playsInline />
          )}
        </div>

        <div className="story-sheet-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={pickFile}
            className="story-file-input"
            id="story-media"
          />
          <label htmlFor="story-media" className="btn btn-ghost btn-sm">
            Photo / video
          </label>
          {mode !== 'text' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setMode('text');
                setFile(null);
              }}
            >
              Use text
            </button>
          )}
          <span className="story-limit-note">Image ≤ 5MB · Video ≤ 50MB</span>
        </div>

        {mode === 'text' && (
          <div className="story-sheet-row" role="group" aria-label="Background">
            {BACKGROUNDS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`story-bg-swatch story-bg-${option.key} ${background === option.key ? 'is-active' : ''}`}
                onClick={() => setBackground(option.key)}
                aria-label={option.label}
                aria-pressed={background === option.key}
              />
            ))}
          </div>
        )}

        <label className="story-field">
          <span>Caption (optional)</span>
          <input
            type="text"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={200}
            placeholder="Add a caption"
          />
        </label>

        <label className="story-field">
          <span>Who can see this</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
            <option value="followers">Followers only</option>
            <option value="public">Anyone</option>
          </select>
        </label>

        <div className="story-sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Publishing…' : 'Share story'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default StoryComposer;
