import React, { useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import { AlertIcon, CompassIcon, SparklesIcon, ClockIcon } from '../common/icons';

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const countLabel = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const signalsOf = (account) => ({
  favoriteGames: account?.feedSignals?.favoriteGames || 0,
  favoriteGenres: account?.feedSignals?.favoriteGenres || 0,
  favoriteChannels: account?.feedSignals?.favoriteChannels || 0
});

const FeedPanel = ({ account, refresh, notify }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signals = signalsOf(account);
  const total = signals.favoriteGames + signals.favoriteGenres + signals.favoriteChannels;
  const resetAt = formatDate(account.feedResetAt);

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/account/feed-reset');
      setConfirming(false);
      await refresh();
      const cleared = data.cleared || {};
      const count = (cleared.favoriteGames || 0) + (cleared.favoriteGenres || 0) + (cleared.favoriteChannels || 0);
      notify(
        'success',
        count
          ? `Recommendations reset. Cleared ${count} affinity ${count === 1 ? 'signal' : 'signals'}.`
          : 'Recommendations were already at their baseline.'
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reset your recommendations.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="settings-panel-head">
        <div>
          <h2 className="settings-panel-title">Feed algorithm</h2>
          <p className="settings-panel-sub">
            See what shapes "For You", and start over whenever you want.
          </p>
        </div>
        <span className="settings-status">
          <SparklesIcon size={13} /> For You
        </span>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>What For You ranks</h3>
          <p>
            A transparent score, no hidden model: favourite games and genres, favourite
            channels, engagement, then recency. Nothing is learned from your private data.
          </p>
        </div>

        <ul className="settings-signal-list">
          <li>
            <span className="settings-signal-icon"><CompassIcon size={16} /></span>
            <div>
              <strong>Game and genre affinity</strong>
              <span>
                {countLabel(signals.favoriteGames, 'favourite game')} ·{' '}
                {countLabel(signals.favoriteGenres, 'genre')}
              </span>
            </div>
          </li>
          <li>
            <span className="settings-signal-icon"><SparklesIcon size={16} /></span>
            <div>
              <strong>Favourite channels</strong>
              <span>{countLabel(signals.favoriteChannels, 'channel tag')}</span>
            </div>
          </li>
          <li>
            <span className="settings-signal-icon"><ClockIcon size={16} /></span>
            <div>
              <strong>Engagement and recency</strong>
              <span>Likes and comments on a post, then how recently it was published</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Reset recommendations</h3>
          <p>
            Clears the three affinity lists so new posts are ranked from a neutral baseline.
            Your follows, saved posts, blocks and platform choice are not touched.
          </p>
        </div>

        {resetAt && <p className="settings-help">Last reset on {resetAt}.</p>}

        {!confirming ? (
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirming(true)}
              disabled={busy || total === 0}
            >
              {total === 0 ? 'Feed is already at baseline' : 'Reset recommendations'}
            </button>
          </div>
        ) : (
          <div className="settings-confirm">
            <p>
              This clears {countLabel(signals.favoriteGames, 'favourite game')},{' '}
              {countLabel(signals.favoriteGenres, 'genre')} and{' '}
              {countLabel(signals.favoriteChannels, 'favourite channel')} from ranking. It cannot be
              undone, but you can add new favourites at any time.
            </p>
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={reset}
                disabled={busy}
              >
                {busy ? 'Resetting…' : 'Confirm reset'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <span className="settings-inline-error">
            <AlertIcon size={13} /> {error}
          </span>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>Why this is not a pause</h3>
          <p>
            The baseline is not an empty feed. New posts still appear, ordered by engagement and
            recency, and the people you follow are still one tab away.
          </p>
        </div>
      </section>
    </>
  );
};

export default FeedPanel;
