import React from 'react';

/**
 * Skeleton placeholders.
 *
 * A spinner tells the user "something is happening"; a skeleton tells them
 * *what* is about to appear and reserves the space, so the layout does not jump
 * when the data lands. Every composition here is decorative — the container owns
 * the `role="status"` and the screen-reader label, so a screen reader hears
 * "Loading" once instead of 40 empty boxes.
 */

const Block = ({ w = '100%', h = 12, r = 6, className = '', style }) => (
  <span
    className={`skel${className ? ` ${className}` : ''}`}
    style={{ width: w, height: h, borderRadius: r, ...style }}
    aria-hidden="true"
  />
);

const Lines = ({ count = 3, widths = ['100%', '92%', '64%'], gap = 10 }) => (
  <span className="skel-lines" style={{ gap }} aria-hidden="true">
    {Array.from({ length: count }).map((_, idx) => (
      <Block key={idx} w={widths[idx % widths.length] || '100%'} h={11} />
    ))}
  </span>
);

// `role="status"` takes its name from aria-label, not from its content, so the
// label is explicit. That also means one region per page section — nested
// frames would make a screen reader announce "Loading" twice.
const Frame = ({ children, label = 'Loading content', className = '' }) => (
  <div
    className={`skel-frame${className ? ` ${className}` : ''}`}
    role="status"
    aria-live="polite"
    aria-label={label}
  >
    {children}
  </div>
);

const PostCardSkeleton = () => (
  <div className="skel-card">
    <div className="skel-row">
      <Block w={38} h={38} r={999} />
      <span className="skel-stack">
        <Block w={140} h={11} />
        <Block w={86} h={9} />
      </span>
    </div>
    <Block w="58%" h={18} r={8} style={{ margin: '16px 0 12px' }} />
    <Lines count={2} widths={['100%', '88%']} />
    <div className="skel-row skel-footer">
      <Block w={64} h={26} r={999} />
      <Block w={64} h={26} r={999} />
      <Block w={64} h={26} r={999} />
    </div>
  </div>
);

/** Feed / channel / profile post lists. */
export const PostListSkeleton = ({ count = 3 }) => (
  <Frame label="Loading posts">
    <div className="post-list">
      {Array.from({ length: count }).map((_, idx) => (
        <PostCardSkeleton key={idx} />
      ))}
    </div>
  </Frame>
);

/** Clips layout on the feed. */
export const ClipGridSkeleton = ({ count = 6 }) => (
  <Frame label="Loading clips">
    <div className="media-grid">
      {Array.from({ length: count }).map((_, idx) => (
        <Block key={idx} w="100%" h={196} r={18} className="skel-media" />
      ))}
    </div>
  </Frame>
);

/** A single post page: article card + comment rows. */
export const PostDetailSkeleton = () => (
  <Frame label="Loading post">
    <div className="skel-card skel-article">
      <div className="skel-row">
        <Block w={44} h={44} r={999} />
        <span className="skel-stack">
          <Block w={170} h={12} />
          <Block w={110} h={9} />
        </span>
      </div>
      <Block w="72%" h={26} r={9} style={{ margin: '22px 0 16px' }} />
      <Lines count={4} widths={['100%', '96%', '100%', '58%']} gap={12} />
      <Block w="100%" h={210} r={16} style={{ marginTop: 20 }} />
    </div>
    <div className="skel-card">
      <Block w={150} h={14} style={{ marginBottom: 18 }} />
      {Array.from({ length: 3 }).map((_, idx) => (
        <div className="skel-row skel-comment" key={idx}>
          <Block w={32} h={32} r={999} />
          <span className="skel-stack">
            <Block w={120} h={10} />
            <Lines count={2} widths={['100%', '72%']} gap={8} />
          </span>
        </div>
      ))}
    </div>
  </Frame>
);

/** Profile header (avatar, handle, stats) + the first page of posts. */
export const ProfileSkeleton = () => (
  <Frame label="Loading profile">
    <div className="skel-card skel-profile-head">
      <Block w={96} h={96} r={999} />
      <span className="skel-stack skel-profile-id">
        <Block w={210} h={24} r={9} />
        <Block w={140} h={12} />
        <Block w="100%" h={11} />
        <Block w="78%" h={11} />
      </span>
    </div>
    <div className="skel-row skel-stat-row">
      {Array.from({ length: 4 }).map((_, idx) => (
        <Block key={idx} w={118} h={64} r={14} />
      ))}
    </div>
    <div className="post-list">
      <PostCardSkeleton />
      <PostCardSkeleton />
    </div>
  </Frame>
);

/** Server browser cards. */
export const CommunityGridSkeleton = ({ count = 6 }) => (
  <Frame label="Loading servers">
    <div className="skel-grid">
      {Array.from({ length: count }).map((_, idx) => (
        <div className="skel-card skel-tile" key={idx}>
          <Block w={46} h={46} r={14} />
          <span className="skel-stack">
            <Block w="70%" h={14} />
            <Block w="46%" h={10} />
            <Lines count={2} widths={['100%', '82%']} gap={8} />
          </span>
        </div>
      ))}
    </div>
  </Frame>
);

/** Full server room: rail rows, header and message stream. */
export const CommunitySkeleton = () => (
  <Frame label="Loading server">
    <div className="skel-community">
      <aside className="skel-card skel-rail">
        <Block w="62%" h={12} style={{ marginBottom: 16 }} />
        {Array.from({ length: 7 }).map((_, idx) => (
          <Block key={idx} w={`${86 - (idx % 3) * 12}%`} h={28} r={8} />
        ))}
      </aside>
      <section className="skel-card skel-stream">
        <div className="skel-row" style={{ marginBottom: 18 }}>
          <Block w={28} h={28} r={8} />
          <Block w={160} h={16} />
        </div>
        {Array.from({ length: 6 }).map((_, idx) => (
          <div className="skel-row skel-comment" key={idx}>
            <Block w={34} h={34} r={999} />
            <span className="skel-stack">
              <Block w={130} h={10} />
              <Block w={`${92 - (idx % 4) * 13}%`} h={11} />
            </span>
          </div>
        ))}
      </section>
    </div>
  </Frame>
);

/** Chat history inside an already-rendered room. */
export const ChatSkeleton = ({ count = 5 }) => (
  <Frame label="Loading messages">
    {Array.from({ length: count }).map((_, idx) => (
      <div className="skel-row skel-comment" key={idx}>
        <Block w={34} h={34} r={999} />
        <span className="skel-stack">
          <Block w={120} h={10} />
          <Block w={`${88 - (idx % 4) * 11}%`} h={11} />
        </span>
      </div>
    ))}
  </Frame>
);

/** LFG board cards. */
export const LfgSkeleton = ({ count = 3 }) => (
  <Frame label="Loading squads">
    <div className="skel-grid skel-grid-wide">
      {Array.from({ length: count }).map((_, idx) => (
        <div className="skel-card skel-lfg" key={idx}>
          <Block w="100%" h={132} r={14} />
          <Block w="62%" h={18} r={8} style={{ marginTop: 16 }} />
          <Block w="40%" h={11} />
          <div className="skel-row" style={{ marginTop: 10 }}>
            <Block w={86} h={24} r={999} />
            <Block w={64} h={24} r={999} />
          </div>
        </div>
      ))}
    </div>
  </Frame>
);

/** Game catalog tiles. */
export const GameGridSkeleton = ({ count = 12 }) => (
  <Frame label="Loading games">
    <div className="skel-grid skel-grid-tight">
      {Array.from({ length: count }).map((_, idx) => (
        <div className="skel-card skel-tile" key={idx}>
          <Block w="100%" h={124} r={12} />
          <Block w="76%" h={13} style={{ marginTop: 12 }} />
          <Block w="48%" h={10} />
        </div>
      ))}
    </div>
  </Frame>
);

/** Admin dashboard: stat cards + table. */
export const AdminSkeleton = () => (
  <Frame label="Loading dashboard">
    <div className="skel-row skel-grid-tight" style={{ flexWrap: 'wrap', gap: 16 }}>
      {Array.from({ length: 4 }).map((_, idx) => (
        <Block key={idx} w={210} h={104} r={16} />
      ))}
    </div>
    <div className="skel-card" style={{ marginTop: 20 }}>
      {Array.from({ length: 6 }).map((_, idx) => (
        <div className="skel-row skel-table-row" key={idx}>
          <Block w="22%" h={11} />
          <Block w="30%" h={11} />
          <Block w="18%" h={11} />
          <Block w="14%" h={11} />
        </div>
      ))}
    </div>
  </Frame>
);

/** Settings rail + one panel. */
export const SettingsSkeleton = () => (
  <Frame label="Loading settings">
    <div className="skel-community">
      <aside className="skel-card skel-rail">
        {Array.from({ length: 5 }).map((_, idx) => (
          <Block key={idx} w="88%" h={44} r={12} />
        ))}
      </aside>
      <section className="skel-card skel-stream">
        <Block w="44%" h={22} r={9} />
        <Block w="66%" h={11} style={{ margin: '12px 0 22px' }} />
        <Lines count={3} widths={['100%', '94%', '70%']} gap={12} />
        <Block w={150} h={40} r={10} style={{ marginTop: 24 }} />
      </section>
    </div>
  </Frame>
);

export { Block as SkeletonBlock };
