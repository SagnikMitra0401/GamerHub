import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import YouTubeEmbed from './YouTubeEmbed';

/**
 * A YouTube post must not contact YouTube before the viewer asks for it, and
 * the embed must use the privacy-enhanced host when it finally loads.
 */
describe('YouTubeEmbed', () => {
  it('renders a facade with the real thumbnail and no iframe', () => {
    const { container } = render(<YouTubeEmbed videoId="dQw4w9WgXcQ" title="Clutch clip" />);

    expect(screen.getByRole('button', { name: 'Play Clutch clip' })).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    expect(screen.getByText('YouTube')).toBeInTheDocument();
  });

  it('loads the youtube-nocookie iframe only after the click', async () => {
    const { container } = render(<YouTubeEmbed videoId="dQw4w9WgXcQ" title="Clutch clip" />);

    await userEvent.click(screen.getByRole('button', { name: 'Play Clutch clip' }));

    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame).toHaveAttribute('title', 'Clutch clip');
    expect(frame.getAttribute('src')).toMatch(
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/,
    );
    expect(frame.getAttribute('src')).toContain('rel=0');
  });

  it('renders nothing without an id', () => {
    const { container } = render(<YouTubeEmbed videoId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
