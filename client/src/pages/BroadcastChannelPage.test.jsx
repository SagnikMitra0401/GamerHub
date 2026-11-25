import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BroadcastChannelPage from './BroadcastChannelPage';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../api/axiosInstance', () => ({ default: mocks }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'u1', username: 'author' } }),
}));
vi.mock('../api/socket', () => ({ getSocket: () => null }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ slug: 'audit-channel' }) };
});

const videoUrl =
  'https://res.cloudinary.com/demo/video/upload/c_limit,q_auto,w_1280/v1/broadcast.mp4';
const channel = {
  _id: 'c1',
  name: 'Audit channel',
  slug: 'audit-channel',
  category: 'gaming',
  description: '',
  isPublic: true,
  subscriberCount: 0,
  messageCount: 1,
  isOwner: true,
  canPublish: true,
  isSubscribed: false,
  muted: false,
};
const message = {
  _id: 'm1',
  channelId: 'c1',
  text: 'Broadcast fixture',
  mediaType: 'video',
  mediaUrl: videoUrl,
  publishedAt: new Date().toISOString(),
  author: { _id: 'u1', username: 'author' },
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.get.mockImplementation((url) => {
    if (String(url).endsWith('/messages')) {
      return Promise.resolve({ data: { items: [message], nextBefore: null } });
    }
    return Promise.resolve({ data: channel });
  });
});

describe('BroadcastChannelPage video delivery', () => {
  it('uses the transformed video URL and its derived poster', async () => {
    const { container } = render(
      <MemoryRouter>
        <BroadcastChannelPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(container.querySelector('.broadcast-post video')).toBeTruthy());
    const video = container.querySelector('.broadcast-post video');
    expect(video).toHaveAttribute('src', videoUrl);
    expect(video).toHaveAttribute(
      'poster',
      'https://res.cloudinary.com/demo/video/upload/so_0,w_640,c_limit,q_auto/c_limit,q_auto,w_1280/v1/broadcast.jpg',
    );
    // Opening a channel must not silently clear its unread marker.
    expect(mocks.post).not.toHaveBeenCalledWith('/channels/audit-channel/read');
  });
});
