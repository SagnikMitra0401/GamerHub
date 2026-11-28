/**
 * The CSRF replay, without a server.
 *
 * A rejection is handed straight to the interceptor, so the test sees what the
 * browser sees: the first mutation is refused, the refusal stores a token, and
 * the same call is replayed once with that token in the header. The adapter
 * writes the cookie itself, because a real Set-Cookie is what the server will
 * check the replay against.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import axiosInstance from './axiosInstance';

/** Answer one request through a function instead of the network. */
const adapterFrom = (handler) => async (config) => {
  const { status, data } = handler(config);
  if (status >= 200 && status < 300) {
    return { data, status, statusText: 'OK', headers: {}, config };
  }
  const error = new Error(`Request failed with status code ${status}`);
  error.config = config;
  error.response = { data, status, statusText: '', headers: {}, config };
  throw error;
};

const tokenOf = (config) => {
  const token =
    typeof config.headers?.get === 'function'
      ? config.headers.get('x-csrf-token')
      : config.headers?.['x-csrf-token'];
  return token || undefined;
};

const storeCsrf = (token) => {
  document.cookie = `gh_csrf=${token}; path=/`;
};

const clearCsrfCookie = () => {
  document.cookie = 'gh_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
};

describe('CSRF recovery', () => {
  beforeEach(clearCsrfCookie);

  it('replays a refused mutation with the token the refusal stored', async () => {
    const sent = [];
    const adapter = adapterFrom((config) => {
      const token = tokenOf(config);
      sent.push(token);
      if (!token) {
        storeCsrf('first-token');
        return { status: 403, data: { code: 'CSRF_REQUIRED' } };
      }
      return { status: 200, data: { saved: true } };
    });

    const res = await axiosInstance.patch('/users/me/preferences', { theme: 'dark' }, { adapter });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ saved: true });
    expect(sent).toEqual([undefined, 'first-token']);
  });

  it('replays once, so a refusal that keeps replacing the token cannot loop', async () => {
    let calls = 0;
    const adapter = adapterFrom(() => {
      calls += 1;
      storeCsrf(`token-${calls}`);
      return { status: 403, data: { code: 'CSRF_REQUIRED' } };
    });

    await expect(axiosInstance.post('/posts', { title: 'x' }, { adapter })).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('does not replay when the browser stored no token', async () => {
    let calls = 0;
    const adapter = adapterFrom(() => {
      calls += 1;
      return { status: 403, data: { code: 'CSRF_REQUIRED' } };
    });

    await expect(axiosInstance.post('/posts', { title: 'x' }, { adapter })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
