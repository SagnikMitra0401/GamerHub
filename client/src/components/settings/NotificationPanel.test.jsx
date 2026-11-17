import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NotificationPanel from './NotificationPanel';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  refresh: vi.fn(),
  notify: vi.fn()
}));

vi.mock('../../api/axiosInstance', () => ({
  default: { patch: mocks.patch }
}));

const account = {
  notificationSettings: { comments: true, follows: true, likes: true, lfg: true, bot: true }
};

const renderPanel = () =>
  render(
    <MemoryRouter>
      <NotificationPanel account={account} refresh={mocks.refresh} notify={mocks.notify} />
    </MemoryRouter>
  );

beforeEach(() => {
  mocks.patch.mockReset().mockResolvedValue({
    data: { notificationSettings: { comments: true, follows: false, likes: true, lfg: true, bot: true } }
  });
  mocks.refresh.mockReset().mockResolvedValue({});
  mocks.notify.mockReset();
});

describe('NotificationPanel', () => {
  it('saves one switched-off category without changing the others', async () => {
    const user = userEvent.setup();
    renderPanel();

    const follows = screen.getByRole('switch', { name: 'New followers' });
    expect(follows).toBeChecked();
    await user.click(follows);
    expect(follows).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Comments and replies' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Save notification preferences' }));

    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/account/notification-settings', {
      comments: true,
      follows: false,
      likes: true,
      lfg: true,
      bot: true
    }));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith('success', 'Notification preferences saved.');
  });
});
