const { isLoopbackOrigin } = require('./origins');

const strip = (value) => String(value || '').trim().replace(/\/+$/, '');

/**
 * Canonical public origin for links that leave the app (server invites).
 *
 * `window.location.origin` is only right when the person copying the link is
 * already on the deployed domain; a link copied from a preview or dev session
 * would otherwise read `localhost` and be useless to a friend. `CLIENT_URL`
 * (which also drives CORS) is the deployment's declared public origin, so the
 * first non-loopback entry wins. Without it the browser's Origin is used, then
 * the request host — enough for local development and plain servers.
 */
function publicBaseUrl(req) {
  const configured = String(process.env.CLIENT_URL || '')
    .split(',')
    .map(strip)
    .filter(Boolean);

  const publicOrigin = configured.find((origin) => !isLoopbackOrigin(origin));
  if (publicOrigin) return publicOrigin;

  const requestOrigin = strip(req?.get?.('origin'));
  if (requestOrigin) return requestOrigin;

  if (configured[0]) return configured[0];

  const host = strip(req?.get?.('host'));
  return host ? `${req.protocol || 'http'}://${host}` : '';
}

module.exports = { publicBaseUrl };
