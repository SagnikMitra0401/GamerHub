import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HashtagText from './HashtagText';

const renderText = (text) => render(
  <MemoryRouter>
    <p><HashtagText text={text} /></p>
  </MemoryRouter>
);

describe('HashtagText', () => {
  it('links a hashtag to its channel with a canonical tag', () => {
    renderText('gg #EldenRing tonight');
    expect(screen.getByRole('link', { name: '#EldenRing' }))
      .toHaveAttribute('href', '/c/eldenring');
  });

  it('links a shared invite URL and keeps the sentence punctuation outside', () => {
    const { container } = renderText('Join http://localhost:3000/join/abc123, see you');
    const link = screen.getByRole('link', { name: 'http://localhost:3000/join/abc123' });
    expect(link).toHaveAttribute('href', 'http://localhost:3000/join/abc123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(container.textContent).toContain(', see you');
  });

  it('keeps URLs clickable while leaving hashtags plain in squad chat', () => {
    render(
      <MemoryRouter>
        <p><HashtagText text="join us #CoOp http://localhost:3000/join/abc123" hashtags={false} /></p>
      </MemoryRouter>
    );
    expect(screen.queryByRole('link', { name: '#CoOp' })).toBeNull();
    expect(screen.getByRole('link', { name: 'http://localhost:3000/join/abc123' })).toBeTruthy();
  });

  it('does not turn an empty or plain string into a link', () => {
    const { container } = renderText('Just a normal sentence.');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});
