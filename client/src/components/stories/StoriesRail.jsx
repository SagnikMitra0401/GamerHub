import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import axiosInstance from '../../api/axiosInstance';
import SafeImage from '../common/SafeImage';
import StoryViewer from './StoryViewer';
import StoryComposer from './StoryComposer';

/**
 * Story rail at the top of the feed.
 *
 * "Your story" opens the composer when you have nothing live, otherwise plays
 * your own status. Other authors keep an unseen ring until every one of their
 * stories has been viewed.
 */
const StoriesRail = () => {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get('/stories');
      setGroups(Array.isArray(data) ? data : []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const ownIndex = groups.findIndex((group) => group.isOwn);
  const ownGroup = ownIndex === -1 ? null : groups[ownIndex];
  const otherGroups = groups.filter((group) => !group.isOwn);

  const openGroup = (group) => {
    const index = groups.indexOf(group);
    const unseen = group.stories.findIndex((story) => !story.seen);
    setViewer({ index, story: unseen === -1 ? 0 : unseen });
  };

  const closeViewer = () => {
    setViewer(null);
    load();
  };

  return (
    <>
      <section className="stories-rail" aria-label="Stories">
        {user && <button
          type="button"
          className={`story-tile story-tile-own ${ownGroup && !ownGroup.seen ? 'is-unseen' : ''}`}
          onClick={() => (ownGroup ? openGroup(ownGroup) : setComposerOpen(true))}
          aria-label={ownGroup ? 'Play your story' : 'Add your story'}
        >
          <span className={`story-avatar ${ownGroup && !ownGroup.seen ? 'story-ring' : ''}`}>
            {user.avatarUrl ? (
              <SafeImage src={user.avatarUrl} alt="" className="story-avatar-img" />
            ) : (
              <span className="avatar-initials" aria-hidden="true">
                {user.username?.[0]?.toUpperCase() || '?'}
              </span>
            )}
            {!ownGroup && <span className="story-add-badge" aria-hidden="true">+</span>}
          </span>
          <span className="story-tile-name">Your story</span>
        </button>}

        {loading && !groups.length && (
          <span className="stories-loading" aria-hidden="true">Loading stories…</span>
        )}

        {otherGroups.map((group) => (
          <button
            type="button"
            key={group.author._id}
            className={`story-tile ${group.seen ? 'is-seen' : 'is-unseen'}`}
            onClick={() => openGroup(group)}
            aria-label={`${group.author.username}'s story${group.seen ? '' : ' (unseen)'}`}
          >
            <span className={`story-avatar ${group.seen ? 'story-ring-seen' : 'story-ring'}`}>
              {group.author.avatarUrl ? (
                <SafeImage src={group.author.avatarUrl} alt="" className="story-avatar-img" />
              ) : (
                <span className="avatar-initials" aria-hidden="true">
                  {group.author.username?.[0]?.toUpperCase() || '?'}
                </span>
              )}
            </span>
            <span className="story-tile-name">{group.author.username}</span>
          </button>
        ))}

        {!loading && !ownGroup && otherGroups.length === 0 && (
          <p className="stories-hint">
            {user ? 'Share a status. It disappears after 24 hours.' : 'Sign in to share a status.'}
          </p>
        )}
      </section>

      <StoryComposer
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={load}
      />

      {viewer && (
        <StoryViewer
          groups={groups}
          startGroup={viewer.index}
          startStory={viewer.story}
          onClose={closeViewer}
        />
      )}
    </>
  );
};

export default StoriesRail;
