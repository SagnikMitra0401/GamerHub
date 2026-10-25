import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import { setMedia } from '../../test/media';

/**
 * The bell is one component with two shells: a dropdown on desktop and a
 * centred, portalled sheet on phones. Pass 2 of the UI review replaced the
 * clipping `right: -70px` dropdown with that sheet, so the breakpoint switch is
 * what these tests protect.
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  socketOn: vi.fn(),
  socketOff: vi.fn(),
  auth: { user: { _id: 'u1' }, token: 'token' }
}));

vi.mock('../../api/axiosInstance', () => ({
  default: { get: mocks.get, patch: mocks.patch, post: mocks.post }
}));

vi.mock('../../api/socket', () => ({
  connectSocket: () => ({ on: mocks.socketOn, off: mocks.socketOff })
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mocks.auth
}));

const notification = (overrides = {}) => ({
  _id: 'n1',
  type: 'lfg_request',
  title: 'Wolf wants to join',
  message: 'Valorant · 2 slots',
  read: false,
  createdAt: new Date().toISOString(),
  actionUrl: '/lfg',
  ...overrides
});

const renderBell = () =>
  render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  );

beforeEach(() => {
  mocks.auth.user = { _id: 'u1' };
  mocks.auth.token = 'token';
  mocks.get.mockReset().mockResolvedValue({
    data: { items: [notification(), notification({ _id: 'n2', read: true, title: 'Older ping' })], unreadCount: 2 }
  });
  mocks.patch.mockReset().mockResolvedValue({ data: {} });
  mocks.post.mockReset().mockResolvedValue({ data: {} });
  setMedia({ sheet: false });
});

describe('NotificationBell', () => {
  it('renders nothing for a signed-out visitor', () => {
    mocks.auth.user = null;
    const { container } = renderBell();

    expect(container).toBeEmptyDOMElement();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('shows the unread count on the trigger', async () => {
    renderBell();

    const trigger = await screen.findByRole('button', { name: 'Notifications (2 unread)' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(within(trigger).getByText('2')).toBeInTheDocument();
  });

  it('opens a dropdown inside the wrapper on a wide viewport', async () => {
    setMedia({ sheet: false });
    renderBell();

    await userEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));

    expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveClass('notif-panel');
    expect(document.querySelector('.notif-sheet-layer')).toBeNull();
    expect(screen.getByRole('button', { name: /^Notifications/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens a portalled modal sheet on a phone so nothing can clip', async () => {
    setMedia({ sheet: true });
    renderBell();

    await userEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));

    const layer = document.querySelector('.notif-sheet-layer');
    expect(layer).not.toBeNull();
    expect(layer.parentElement).toBe(document.body);

    const sheet = screen.getByRole('dialog', { name: 'Notifications' });
    expect(sheet).toHaveClass('notif-sheet');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    // Scrim + header control: both dismiss, both must be reachable.
    expect(within(layer).getAllByRole('button', { name: 'Close notifications' })).toHaveLength(2);
  });

  it('closes on Escape and keeps the trigger in sync', async () => {
    renderBell();

    const trigger = await screen.findByRole('button', { name: /^Notifications/ });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks everything read optimistically', async () => {
    renderBell();

    await userEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/notifications/read-all'));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(document.querySelector('.notif-badge')).toBeNull();
  });

  it('marks a single notification read on open and decrements the badge', async () => {
    renderBell();

    await userEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
    await userEvent.click(screen.getByText('Wolf wants to join'));

    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/notifications/n1/read'));
    expect(document.querySelectorAll('.notif-item.unread')).toHaveLength(0);
    expect(document.querySelector('.notif-badge')).toHaveTextContent('1');
  });

  it('adds a socket payload to the open list and bumps the badge', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));

    const [, onNotification] = mocks.socketOn.mock.calls.find(([event]) => event === 'notification');
    await act(async () => { onNotification(notification({ _id: 'n3', title: 'Fresh ping' })); });

    expect(await screen.findByText('Fresh ping')).toBeInTheDocument();
    expect(document.querySelector('.notif-badge')).toHaveTextContent('3');
  });
});
