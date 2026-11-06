import React from 'react';

/**
 * Shared line-icon set. Every glyph inherits `currentColor` and is sized by
 * width/height props, so colour and spring animations are handled entirely in
 * CSS. `aria-hidden` is set because the surrounding control always carries the
 * accessible label.
 */
const Svg = ({ children, size = 16, className = '', ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const CompassIcon = props => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1z" />
  </Svg>
);

export const UsersIcon = props => (
  <Svg {...props}>
    <path d="M16 20v-1.7a3.8 3.8 0 0 0-3.8-3.8H6.3A3.8 3.8 0 0 0 2.5 18.3V20" />
    <circle cx="9.2" cy="7.6" r="3.6" />
    <path d="M21.5 20v-1.7a3.8 3.8 0 0 0-2.9-3.7" />
    <path d="M16.1 4.1a3.8 3.8 0 0 1 0 7.1" />
  </Svg>
);

export const MailIcon = props => (
  <Svg {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Svg>
);

export const SparklesIcon = props => (
  <Svg {...props}>
    <path d="M11.5 3.2l1.6 4.2 4.2 1.6-4.2 1.6-1.6 4.2-1.6-4.2L5.7 9l4.2-1.6 1.6-4.2z" />
    <path d="M18.4 14.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
  </Svg>
);

export const FlameIcon = props => (
  <Svg {...props}>
    <path d="M12 21.2c3.5 0 6-2.3 6-5.6 0-2.5-1.5-4.3-3-5.8-.5-.5-1.3-.1-1.3.6 0 .9-.4 1.7-1 2.1.2-2.5-1.1-4.9-3-6.3-.5-.4-1.3 0-1.2.7.2 1.7-.5 3-1.5 4.1-.9 1-2 2.3-2 4.6 0 3.3 2.5 5.6 6 5.6z" />
    <path d="M12 21.2c-1.7 0-3-1.2-3-2.9 0-1.4.9-2.2 1.7-3 .3-.3.8-.1.8.3 0 .6.3 1 .7 1.2-.1-1.2.4-2.3 1.1-3 .3-.3.8-.1.8.3 0 1.2 1 1.9 1 3.5 0 2-1.4 3.6-3.1 3.6z" />
  </Svg>
);

export const ClockIcon = props => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.2V12l3.4 2" />
  </Svg>
);

export const ListIcon = props => (
  <Svg {...props}>
    <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" />
    <path d="M3.8 6.5h.01M3.8 12h.01M3.8 17.5h.01" strokeWidth="2.4" />
  </Svg>
);

export const FilmIcon = props => (
  <Svg {...props}>
    <rect x="2.8" y="4.5" width="18.4" height="15" rx="2.4" />
    <path d="M7.6 4.5v15M16.4 4.5v15M2.8 12h18.4" />
  </Svg>
);

export const HeartIcon = props => (
  <Svg {...props}>
    <path d="M20.6 5.8a5.1 5.1 0 0 0-7.2 0L12 7.2l-1.4-1.4a5.1 5.1 0 1 0-7.2 7.2l1.4 1.4L12 21.6l7.2-7.2 1.4-1.4a5.1 5.1 0 0 0 0-7.2z" />
  </Svg>
);

export const BookmarkIcon = props => (
  <Svg {...props}>
    <path d="M18.4 21l-6.4-4.6L5.6 21V5.4A2.4 2.4 0 0 1 8 3h8a2.4 2.4 0 0 1 2.4 2.4V21z" />
  </Svg>
);

export const CommentIcon = props => (
  <Svg {...props}>
    <path d="M20.6 11.6a7.7 7.7 0 0 1-8.3 7.7 8.4 8.4 0 0 1-2.9-.6L4 20.4l1.7-4.6a7.6 7.6 0 0 1-.9-3.6 7.7 7.7 0 0 1 7.7-7.7h.5a7.7 7.7 0 0 1 7.6 7.1z" />
  </Svg>
);

export const CheckIcon = props => (
  <Svg {...props}>
    <path d="M20 6.5L9.5 17 4 11.5" />
  </Svg>
);

export const HomeIcon = props => (
  <Svg {...props}>
    <path d="M3.5 10.4 12 3.4l8.5 7" />
    <path d="M5.8 9.2V20h12.4V9.2" />
    <path d="M10 20v-5.2h4V20" />
  </Svg>
);

export const SearchIcon = props => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="m16 16 4.4 4.4" />
  </Svg>
);

export const PlusIcon = props => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const ServerIcon = props => (
  <Svg {...props}>
    <rect x="3.5" y="4" width="17" height="6.2" rx="2" />
    <rect x="3.5" y="13.8" width="17" height="6.2" rx="2" />
    <path d="M7.2 7.1h.01M7.2 16.9h.01" strokeWidth="2.2" />
  </Svg>
);

export const GamepadIcon = props => (
  <Svg {...props}>
    <rect x="2.6" y="7" width="18.8" height="10" rx="5" />
    <path d="M7.3 10.2v3.6M5.5 12h3.6" />
    <circle cx="16" cy="10.8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="18.2" cy="13.4" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

export const SettingsIcon = props => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.4v2.1M12 18.5v2.1M4.8 7.8l1.8 1M17.4 15.2l1.8 1M4.8 16.2l1.8-1M17.4 8.8l1.8-1" />
  </Svg>
);

export const ScrollIcon = props => (
  <Svg {...props}>
    <path d="M6.5 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-11" />
    <path d="M6.5 4a2.5 2.5 0 0 0 0 5h2.2" />
    <path d="M4.5 19.6A1.9 1.9 0 0 0 6.5 21h11" />
    <path d="M10.6 9.4h6M10.6 13h6M10.6 16.6h4" />
  </Svg>
);

export const TrashIcon = props => (
  <Svg {...props}>
    <path d="M4.5 6.8h15M9.4 6.8V4.9h5.2v1.9" />
    <path d="M6.6 6.8 7.6 20h8.8l1-13.2" />
    <path d="M10.3 10.5v5.6M13.7 10.5v5.6" />
  </Svg>
);

export const PencilIcon = props => (
  <Svg {...props}>
    <path d="M4.2 19.8h3.3L19 8.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L4.2 16.5v3.3z" />
    <path d="m14.4 6.2 3.4 3.4" />
  </Svg>
);

export const LockIcon = props => (
  <Svg {...props}>
    <rect x="5.2" y="10.4" width="13.6" height="9.6" rx="2.2" />
    <path d="M8.4 10.4V7.9a3.6 3.6 0 0 1 7.2 0v2.5" />
  </Svg>
);

export const MicIcon = props => (
  <Svg {...props}>
    <rect x="9.2" y="3.2" width="5.6" height="10.2" rx="2.8" />
    <path d="M6.2 11.4a5.8 5.8 0 0 0 11.6 0M12 17.2v3.4M9.2 20.6h5.6" />
  </Svg>
);

export const TrophyIcon = props => (
  <Svg {...props}>
    <path d="M8.2 4.4h7.6v4.4a3.8 3.8 0 0 1-7.6 0V4.4z" />
    <path d="M8.2 6H5.4v1.6a3 3 0 0 0 3 3M15.8 6h2.8v1.6a3 3 0 0 1-3 3" />
    <path d="M12 12.8v3.4M8.6 20h6.8l-.8-3.8H9.4L8.6 20z" />
  </Svg>
);

export const BellIcon = props => (
  <Svg {...props}>
    <path d="M6.4 10.2a5.6 5.6 0 0 1 11.2 0c0 4 1.4 5.3 1.4 5.3H5s1.4-1.3 1.4-5.3z" />
    <path d="M10.2 18.7a2 2 0 0 0 3.6 0" />
  </Svg>
);

export const LinkIcon = props => (
  <Svg {...props}>
    <path d="M9.6 14.4 14.4 9.6" />
    <path d="M11.3 7.4l1.5-1.5a3.9 3.9 0 0 1 5.5 5.5l-1.5 1.5" />
    <path d="M12.7 16.6 11.2 18a3.9 3.9 0 0 1-5.5-5.5l1.5-1.5" />
  </Svg>
);

export const CopyIcon = props => (
  <Svg {...props}>
    <rect x="9" y="9" width="10.6" height="10.6" rx="2" />
    <path d="M15 6.4V5.8a1.8 1.8 0 0 0-1.8-1.8H5.8A1.8 1.8 0 0 0 4 5.8v7.4A1.8 1.8 0 0 0 5.8 15h.6" />
  </Svg>
);

export const DownloadIcon = props => (
  <Svg {...props}>
    <path d="M12 3.8v10.6M7.8 10.4 12 14.6l4.2-4.2" />
    <path d="M4.6 16.6v1.6a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-1.6" />
  </Svg>
);

export const StarIcon = props => (
  <Svg {...props}>
    <path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8L12 3.8z" />
  </Svg>
);

export const AlertIcon = props => (
  <Svg {...props}>
    <path d="M12 3.8 21 19.4H3L12 3.8z" />
    <path d="M12 9.4v4.2M12 16.8h.01" strokeWidth="2.2" />
  </Svg>
);

export const SendIcon = props => (
  <Svg {...props}>
    <path d="M20.4 3.6 3.6 10.2l6.2 2.4 2.4 6.2 8.2-15.2z" />
    <path d="m9.8 12.6 4.6-4.6" />
  </Svg>
);

export const ReplyIcon = props => (
  <Svg {...props}>
    <path d="M9 7L4 12l5 5" />
    <path d="M4 12h8.5a5.5 5.5 0 0 1 5.5 5.5V19" />
  </Svg>
);

export const PinIcon = props => (
  <Svg {...props}>
    <path d="M9.5 3h5l-.8 5.2 3.3 3.3H7l3.3-3.3z" />
    <path d="M12 11.5V21" />
  </Svg>
);

export const PaperclipIcon = props => (
  <Svg {...props}>
    <path d="M20 11.5l-7.6 7.6a4.6 4.6 0 0 1-6.5-6.5l8-8a3.1 3.1 0 0 1 4.4 4.4l-8 8a1.6 1.6 0 0 1-2.2-2.2l7.2-7.2" />
  </Svg>
);

export const MenuIcon = props => (
  <Svg {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const CloseIcon = props => (
  <Svg {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const ArrowLeftIcon = props => (
  <Svg {...props}>
    <path d="M19 12H5" />
    <path d="m10.6 5.8-5.9 6.2 5.9 6.2" />
  </Svg>
);

export const ArrowRightIcon = props => (
  <Svg {...props}>
    <path d="M5 12h14" />
    <path d="m13.4 5.8 5.9 6.2-5.9 6.2" />
  </Svg>
);

