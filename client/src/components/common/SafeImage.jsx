import React, { useEffect, useState } from 'react';

/**
 * An <img> that never leaves the browser's broken-image glyph on screen.
 *
 * Remote media (game covers, Cloudinary posts, community banners) can fail for
 * reasons the app does not control: a deleted asset, a blocked host or a
 * transient network error. The fallback keeps the layout meaningful instead of
 * showing an empty image icon.
 */
const SafeImage = ({ src, alt = '', fallback = null, onError, referrerPolicy = 'no-referrer', ...props }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return fallback;

  return (
    <img
      {...props}
      src={src}
      alt={alt}
      referrerPolicy={referrerPolicy}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
};

export default SafeImage;
