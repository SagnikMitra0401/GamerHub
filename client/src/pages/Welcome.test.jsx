import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Welcome from './Welcome';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  updateUser: vi.fn(),
  user: { _id: 'u1', username: 'new_player', preferences: {} },
}));

vi.mock('../api/axiosInstance', () => ({
  default: { get: mocks.get, post: mocks.post },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: mocks.user,
    updateUser: mocks.updateUser,
  }),
}));

const DISCOVERY = {
  games: ['Valorant'],
  platforms: ['PC'],
  squads: [
    {
      id: 'squad1',
      gameTitle: 'Valorant',
      activity: 'Ranked',
      openSlots: 2,
      maxSlots: 5,
      micRequired: true,
      leader: { id: 'owner1', username: 'owner', level: 4, presence: { status: 'online' } },
      popular: false,
    },
  ],
  communities: [
    {
      id: 'community1',
      name: 'Valorant Onboarding QA',
      slug: 'valorant-onboarding-qa',
      description: 'A public server for the discovery test.',
      icon: 'V',
      memberCount: 3,
      games: ['Valorant'],
      popular: false,
    },
  ],
  players: [
    {
      id: 'player1',
      username: 'owner',
      level: 4,
      presence: { status: 'online' },
      sharedGames: ['Valorant'],
      following: false,
    },
  ],
  tags: [{ tag: 'valorant', postCount: 2 }],
  fallback: { squads: false, communities: false },
};

const renderWelcome = () =>
  render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Welcome />
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ data: DISCOVERY });
  mocks.post.mockReset().mockImplementation((url) => {
    if (url === '/discover/onboarding/complete') {
      return Promise.resolve({
        data: {
          onboardingCompletedAt: '2026-11-15T00:00:00.000Z',
          preferences: { favoriteGames: ['Valorant'], platforms: ['PC'] },
        },
      });
    }
    return Promise.resolve({ data: { message: 'ok' } });
  });
  mocks.updateUser.mockReset();
  mocks.user = { _id: 'u1', username: 'new_player', preferences: {} };
});

describe('game-first onboarding', () => {
  it('takes a new account from games to platforms to suggestions', async () => {
    const user = userEvent.setup();
    renderWelcome();

    expect(screen.getByRole('heading', { name: /find your people/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Valorant' }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByRole('heading', { name: 'Where do you play?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /PC/ }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('Valorant Onboarding QA')).toBeInTheDocument();
    expect(screen.getByText('Open squads')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/discover/onboarding?games=Valorant&platforms=PC');
  });

  it('joins a suggested server explicitly and finishes with the tuned state', async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole('button', { name: 'Valorant' }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /PC/ }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await user.click(await screen.findByRole('button', { name: 'Join server' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/communities/community1/join'));
    expect(await screen.findByRole('button', { name: 'Joined' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    expect(await screen.findByText('Your feed is tuned')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith('/discover/onboarding/complete', {
      games: ['Valorant'],
      platforms: ['PC'],
      skipped: false,
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      onboardingCompletedAt: '2026-11-15T00:00:00.000Z',
      preferences: { favoriteGames: ['Valorant'], platforms: ['PC'] },
    });
  });
});
