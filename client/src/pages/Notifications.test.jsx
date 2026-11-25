import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Notifications from './Notifications';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  socketOn: vi.fn(),
  socketOff: vi.fn(),
}));

vi.mock('../api/axiosInstance', () => ({
  default: { get: mocks.get, patch: mocks.patch, post: mocks.post },
}));

vi.mock('../api/socket', () => ({
  connectSocket: () => ({ on: mocks.socketOn, off: mocks.socketOff }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token' }),
}));

const notification = (overrides = {}) => ({
  _id: 'n1',
  type: 'lfg_request',
  title: 'Wolf wants to join',
  message: 'Valorant · 2 slots',
  read: false,
  createdAt: new Date().toISOString(),
  actionUrl: '/lfg',
  ...overrides,
});

const firstPage = {
  items: [
    notification(),
    notification({
      _id: 'n2',
      type: 'social',
      title: 'A comment landed',
      read: true,
      metadata: { kind: 'comment' },
      actionUrl: null,
    }),
  ],
  unreadCount: 1,
  nextCursor: 'cursor-1',
  hasMore: true,
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Notifications />
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ data: firstPage });
  mocks.patch.mockReset().mockResolvedValue({ data: { unreadCount: 0 } });
  mocks.post.mockReset().mockResolvedValue({ data: { unreadCount: 0 } });
});

describe('notification history', () => {
  it('renders the first page with an unread divider and loads older items by cursor', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByText('Wolf wants to join')).toBeInTheDocument();
    expect(screen.getByText('A comment landed')).toBeInTheDocument();
    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/notifications?limit=25');

    mocks.get.mockResolvedValueOnce({
      data: {
        items: [notification({ _id: 'n3', title: 'Old squad ping', read: true })],
        unreadCount: 1,
        nextCursor: null,
        hasMore: false,
      },
    });
    await user.click(screen.getByRole('button', { name: 'Load older' }));

    expect(await screen.findByText('Old squad ping')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenLastCalledWith('/notifications?limit=25&before=cursor-1');
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('marks a notification read when it is opened', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('link', { name: /Wolf wants to join/ }));

    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/notifications/n1/read'));
    expect(screen.getByText(/You are all caught up/)).toBeInTheDocument();
  });

  it('marks the whole page read optimistically', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/notifications/read-all'));
    expect(document.querySelectorAll('.notif-item.unread')).toHaveLength(0);
    expect(screen.getByText(/You are all caught up/)).toBeInTheDocument();
  });
});
