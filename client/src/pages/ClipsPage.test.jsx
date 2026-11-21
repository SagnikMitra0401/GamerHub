import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ClipsPage from './ClipsPage';

/**
 * The clips fetch and `fetchMe` race: clips can arrive while the viewer is
 * still signed out, then the session lands with their saved/liked state. These
 * tests pin that late hydration instead of the signed-out defaults.
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  updateSavedPosts: vi.fn(),
  auth: { user: null, updateSavedPosts: null }
}));

vi.mock('../api/axiosInstance', () => ({
  default: { get: mocks.get, post: mocks.post }
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mocks.auth
}));

const clip = {
  _id: 'p1',
  title: 'Already liked',
  mediaUrl: 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
  userId: { username: 'author' },
  likes: ['u1'],
  likeCount: 1,
  commentCount: 0,
  tags: ['valorant']
};

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const renderPage = () => render(
  <MemoryRouter>
    <ClipsPage />
  </MemoryRouter>
);

beforeEach(() => {
  mocks.auth = { user: null, updateSavedPosts: null };
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.updateSavedPosts.mockReset();
  mocks.auth.updateSavedPosts = mocks.updateSavedPosts;
  mocks.get.mockResolvedValue({ data: [clip] });
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('ClipsPage reaction hydration', () => {
  it('adopts the signed-in like and save state when the session arrives late', async () => {
    const view = renderPage();

    await screen.findByRole('heading', { name: 'Already liked' });
    expect(screen.getByRole('button', { name: 'Like clip' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Save clip' })).toHaveAttribute('aria-pressed', 'false');

    mocks.auth.user = { _id: 'u1', savedPosts: ['p1'] };
    view.rerender(
      <MemoryRouter>
        <ClipsPage />
      </MemoryRouter>
    );

    const unlike = await screen.findByRole('button', { name: 'Unlike clip' });
    expect(unlike).toHaveAttribute('aria-pressed', 'true');
    expect(unlike).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets a hydrated clip unlike without falling back to the stale signed-out view', async () => {
    mocks.auth.user = { _id: 'u1', savedPosts: ['p1'] };
    mocks.post.mockResolvedValue({ data: { liked: false, likeCount: 0 } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Unlike clip' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Like clip' })).toHaveAttribute('aria-pressed', 'false');
    });
    expect(screen.getByRole('button', { name: 'Like clip' })).toHaveTextContent('0');
    expect(mocks.post).toHaveBeenCalledWith('/posts/p1/like');
  });
});
