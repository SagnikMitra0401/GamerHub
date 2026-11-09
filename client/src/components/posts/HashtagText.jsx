import React from 'react';
import { Link } from 'react-router-dom';

// Same shape the server extracts: `#` plus letters, numbers or underscores.
// The capture group is what makes String.split keep the match in the parts list.
// Plain http(s) URLs are captured too, so a shared invite link is clickable
// even when no link preview was scraped for it.
const TOKEN = /(#[\p{L}\p{N}_]{1,24}|https?:\/\/[^\s<]+)/gu;
const IS_HASHTAG = /^#[\p{L}\p{N}_]{1,24}$/u;
const IS_URL = /^https?:\/\//i;
const URL_PARTS = /^(https?:\/\/[^\s<]*?)([.,!?;:)\]]*)$/i;

/** Canonical stored tag for a written #token, matching the server's cleanTag. */
const toTag = (token) => token
  .slice(1)
  .toLowerCase()
  .replace(/[^\p{L}\p{N}_ -]/gu, '')
  .replace(/[\s_]+/g, ' ')
  .trim();

const linkStyle = {
  color: 'var(--primary-light, #a78bfa)',
  fontWeight: 600,
  textDecoration: 'none'
};

/**
 * Renders post text with clickable, Instagram-style #hashtags and real links.
 *
 * Returns a fragment so the caller keeps its own heading/paragraph element
 * and styling; a tag links to that tag's channel page.
 */
const HashtagText = ({ text, hashtags = true }) => {
  if (!text) return null;

  const parts = String(text).split(TOKEN);
  return (
    <>
      {parts.map((part, index) => {
        // Squad chat opts out of channel links but keeps URL linkification.
        if (hashtags && IS_HASHTAG.test(part)) {
          return (
            <Link
              key={`${part}-${index}`}
              to={`/c/${encodeURIComponent(toTag(part))}`}
              className="hashtag"
              style={linkStyle}
              onClick={event => event.stopPropagation()}
            >
              {part}
            </Link>
          );
        }

        if (IS_URL.test(part)) {
          // Keep sentence punctuation outside the anchor.
          const match = part.match(URL_PARTS);
          const href = match?.[1] || part;
          const trailing = match?.[2] || '';
          return (
            <React.Fragment key={`url-${index}`}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="post-link"
                style={linkStyle}
                onClick={event => event.stopPropagation()}
              >
                {href}
              </a>
              {trailing}
            </React.Fragment>
          );
        }

        return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
      })}
    </>
  );
};

export default HashtagText;
