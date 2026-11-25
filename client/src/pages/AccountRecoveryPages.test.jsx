import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../api/axiosInstance', () => ({
  default: { post: mocks.post },
}));

const renderPage = (page, initialEntries = ['/']) =>
  render(<MemoryRouter initialEntries={initialEntries}>{page}</MemoryRouter>);

beforeEach(() => {
  mocks.post.mockReset();
});

describe('account recovery pages', () => {
  it('submits a forgot-password request and shows the generic confirmation', async () => {
    mocks.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage(<ForgotPassword />);

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText(/reset link is on its way/i)).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith('/auth/forgot-password', {
      email: 'player@example.com',
    });
  });

  it('rejects mismatched reset passwords before calling the API', async () => {
    const user = userEvent.setup();
    renderPage(<ResetPassword />, ['/reset-password?token=abc']);

    await user.type(screen.getByLabelText('New password'), 'newpassword123');
    await user.type(screen.getByLabelText('Confirm password'), 'different123');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(screen.getByText('Those passwords do not match.')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('submits a valid reset and shows the sign-in confirmation', async () => {
    mocks.post.mockResolvedValue({ data: { reset: true } });
    const user = userEvent.setup();
    renderPage(<ResetPassword />, ['/reset-password?token=abc']);

    await user.type(screen.getByLabelText('New password'), 'newpassword123');
    await user.type(screen.getByLabelText('Confirm password'), 'newpassword123');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/password has been changed/i)).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'abc',
      password: 'newpassword123',
    });
  });
});
