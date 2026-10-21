import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true
});

/**
 * NOTE: we deliberately do NOT redirect on 401 here. The bootstrap call
 * (`GET /auth/me`) always 401s for a signed-out visitor, and a global redirect
 * made every public page (feed, profiles, servers) unreachable while logged
 * out. Components decide what to do: prompt for login on a protected action,
 * or simply render the anonymous view.
 */
axiosInstance.interceptors.response.use(
  (res) => res,
  (err) => Promise.reject(err)
);

export default axiosInstance;
