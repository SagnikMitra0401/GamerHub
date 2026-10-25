import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PostCard from './PostCard';

/**
 * The card's reaction handlers talk to the API and then trust its answer, so
 * these tests pin the two things that can silently rot: the request path and
 * the state after a rejection.
 */
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
  updateSavedPosts: vi.fn(),
  auth: { user: null, updateSavedPosts: null }
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => mocks.navigate
}));

vi.mock('../../api/axiosInstance', () => ({
  default: { post: mocks.post, delete: mocks.remove }
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mocks.auth
}));

const post = {
  _id: 'p1',
  title: 'Clutch round on Ascent',
  content: 'one tap through smoke',
  createdAt: new Date().toISOString(),
  userId: { _id: 'u9', username: 'neo', level: 7 },
  likeCount: 4,
  likes: [],
  commentCount: 2,
  tags: ['valorant']
};

const signedIn = { _id: 'u1', username: 'me', savedPosts: [] };

const renderCard = (props = {}) =>
  render(
    <MemoryRouter>
      <PostCard post={post} {...props} />
    </MemoryRouter>
  );

beforeEach(() => {
  mocks.auth.user = signedIn;
  mocks.auth.updateSavedPosts = mocks.updateSavedPosts;
  mocks.post.mockReset();
  mocks.remove.mockReset();
  mocks.navigate.mockReset();
  mocks.updateSavedPosts.mockReset();
});

describe('PostCard reactions', () => {
  it('takes the like count and state from the server response', async () => {
    mocks.post.mockResolvedValue({ data: { likeCount: 5, liked: true } });
    const onLikeToggle = vi.fn();
    renderCard({ onLikeToggle });

    await userEvent.click(screen.getByRole('button', { name: 'Like post' }));

    expect(mocks.post).toHaveBeenCalledWith('/posts/p1/like');
    const unlike = screen.getByRole('button', { name: 'Unlike post' });
    expect(unlike).toHaveTextContent('5');
    expect(unlike).toHaveAttribute('aria-pressed', 'true');
    expect(onLikeToggle).toHaveBeenCalledWith('p1', { likeCount: 5, liked: true });
  });

  it('leaves the count untouched when the request fails', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const onLikeToggle = vi.fn();
    renderCard({ onLikeToggle });

    await userEvent.click(screen.getByRole('button', { name: 'Like post' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Like post' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Like post' })).toHaveTextContent('4');
    expect(onLikeToggle).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to the login page instead of calling the API', async () => {
    mocks.auth.user = null;
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Like post' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/login');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('bookmarks through the user endpoint and syncs the session', async () => {
    mocks.post.mockResolvedValue({ data: { saved: true } });
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Bookmark post' }));

    expect(mocks.post).toHaveBeenCalledWith('/users/saved/p1');
    expect(mocks.updateSavedPosts).toHaveBeenCalledWith('p1', true);
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true');
  });
});
