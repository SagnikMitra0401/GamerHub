import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

/** The CSRF cookie is readable by design, so the page can echo it in a header. */
const readCookie = (name) => {
  const entry = document.cookie.split('; ').find((pair) => pair.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : '';
};

const UNSAFE = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * The double-submit token is read from the cookie every time, never copied. The
 * server compares that cookie against the header, so a value held only in memory
 * could not pass on its own.
 */
const csrfToken = () => readCookie('gh_csrf');

/**
 * Every mutation carries the double-submit token. A cross-site form cannot set
 * a header, so the server can tell a request from this application apart from
 * one forged elsewhere.
 */
axiosInstance.interceptors.request.use((config) => {
  if (UNSAFE.includes(String(config.method || 'get').toUpperCase())) {
    const token = csrfToken();
    if (token) config.headers.set('x-csrf-token', token);
  }
  return config;
});

/**
 * NOTE: we deliberately do NOT redirect on 401 here. The bootstrap call
 * (`GET /auth/me`) always 401s for a signed-out visitor, and a global redirect
 * made every public page (feed, profiles, servers) unreachable while logged
 * out. Components decide what to do: prompt for login on a protected action,
 * or simply render the anonymous view.
 */

/**
 * Access tokens live 30 minutes. When one expires the request is not a failure
 * the person should see: it is retried once after exchanging the refresh token.
 *
 * Two rules keep that from becoming a loop. A request is retried at most once
 * (`_retried`), and every tab shares one in-flight refresh, so ten parallel
 * requests produce one rotation rather than ten that race each other.
 */
let refreshing = null;
let refreshes = 0;

const refreshSession = () => {
  if (!refreshing) {
    refreshing = axios
      .post('/api/auth/refresh', null, {
        withCredentials: true,
        // The refresh call bypasses this instance's interceptors, so it names
        // the token itself.
        headers: { 'x-csrf-token': csrfToken() },
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
};

axiosInstance.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { response, config } = err;
    if (!response || !config) throw err;

    // A session that predates the CSRF cookie is refused once, and the refusal
    // stores the token. Replaying from that cookie is what keeps a deploy from
    // signing somebody out of their own actions. With no cookie stored there is
    // nothing to replay with, so the caller sees the refusal.
    if (response.status === 403 && response.data?.code === 'CSRF_REQUIRED') {
      if (config._csrfRetried || !csrfToken()) throw err;
      return axiosInstance({ ...config, _csrfRetried: true });
    }

    if (response.status !== 401) throw err;
    // Only an expiry is repairable. A revoked session or a bad credential is
    // answered by the caller, not by a refresh.
    if (response.data?.code !== 'TOKEN_EXPIRED') throw err;
    if (config._retried || String(config.url || '').includes('/auth/refresh')) throw err;

    try {
      await refreshSession();
      refreshes += 1;
    } catch {
      // The refresh itself was refused: the cookies are gone, so the caller's
      // 401 handling is the right path.
      throw err;
    }

    try {
      return await axiosInstance({ ...config, _retried: true });
    } catch (retryError) {
      if (retryError.response?.data?.code === 'TOKEN_EXPIRED') {
        console.warn('[session] a request was still expired after a refresh', refreshes);
      }
      throw retryError;
    }
  },
);

export default axiosInstance;
