/**
 * Poster frames for uploaded Cloudinary videos.
 *
 * Cloudinary can deliver the first frame of a video as an image by asking for a
 * `.jpg` with a `so_0` transformation. Deriving it from the delivery URL keeps
 * the server schema unchanged: no second asset to store, clean up or backfill.
 * Anything that is not a Cloudinary video URL returns null and the browser falls
 * back to its own first frame.
 */
export function videoPosterUrl(url, width = 640) {
  if (typeof url !== 'string' || !url) return null;
  if (!/res\.cloudinary\.com/.test(url) || !url.includes('/video/upload/')) return null;

  const poster = url
    .replace('/video/upload/', `/video/upload/so_0,w_${width},c_limit,q_auto/`)
    .replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');

  return poster === url ? null : poster;
}

export default videoPosterUrl;
