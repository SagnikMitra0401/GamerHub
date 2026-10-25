import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostActions from './PostActions';
import { setMedia } from '../../test/media';

const baseProps = { likeCount: 4, commentCount: 2 };

/**
 * jsdom reports `WebkitAnimation` on CSSStyleDeclaration, so React resolves the
 * prefixed native event name and never listens for plain `animationend`.
 * Dispatching the wrong one silently passes a broken cleanup.
 */
const animationEnd = 'WebkitAnimation' in document.createElement('div').style
  ? 'webkitAnimationEnd'
  : 'animationend';

describe('PostActions', () => {
  it('exposes the like state to assistive tech', () => {
    const { rerender } = render(<PostActions {...baseProps} liked={false} />);

    const like = screen.getByRole('button', { name: 'Like post' });
    expect(like).toHaveAttribute('aria-pressed', 'false');
    expect(like).toHaveTextContent('4');

    rerender(<PostActions {...baseProps} liked />);
    const unlike = screen.getByRole('button', { name: 'Unlike post' });
    expect(unlike).toHaveAttribute('aria-pressed', 'true');
    expect(unlike).toHaveClass('is-on');
  });

  it('calls onLike once per click, even while the burst is running', async () => {
    setMedia({ finePointer: true });
    const onLike = vi.fn();
    render(<PostActions {...baseProps} onLike={onLike} />);

    const like = screen.getByRole('button', { name: 'Like post' });
    await userEvent.click(like);
    await userEvent.click(like);

    expect(onLike).toHaveBeenCalledTimes(2);
  });

  it('bursts six CSS sparks on a fine pointer and drops them when the animation ends', async () => {
    setMedia({ finePointer: true });
    const { container } = render(<PostActions {...baseProps} onLike={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Like post' }));

    const sparks = container.querySelector('.action-sparks');
    expect(sparks).not.toBeNull();
    expect(sparks.querySelectorAll('i')).toHaveLength(6);
    expect(sparks).toHaveAttribute('aria-hidden', 'true');

    fireEvent(sparks, new Event(animationEnd, { bubbles: true }));
    expect(container.querySelector('.action-sparks')).toBeNull();
  });

  it('skips the burst entirely on touch and reduced-motion', async () => {
    setMedia({ finePointer: false, reducedMotion: true });
    const { container } = render(<PostActions {...baseProps} onLike={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Like post' }));

    expect(container.querySelector('.action-sparks')).toBeNull();
  });

  it('does not burst when unliking', async () => {
    setMedia({ finePointer: true });
    const { container } = render(<PostActions {...baseProps} liked onLike={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Unlike post' }));

    expect(container.querySelector('.action-sparks')).toBeNull();
  });

  it('pluralises the comment affordance', () => {
    const { rerender } = render(<PostActions likeCount={0} commentCount={1} />);
    expect(screen.getByRole('button', { name: 'View 1 comment' })).toBeInTheDocument();

    rerender(<PostActions likeCount={0} commentCount={0} />);
    expect(screen.getByRole('button', { name: 'View 0 comments' })).toBeInTheDocument();

    rerender(<PostActions likeCount={0} commentCount={7} />);
    expect(screen.getByRole('button', { name: 'View 7 comments' })).toBeInTheDocument();
  });

  it('hides the bookmark until a save handler exists, then tracks its state', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<PostActions {...baseProps} />);
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();

    rerender(<PostActions {...baseProps} onSave={onSave} saved={false} />);
    const save = screen.getByRole('button', { name: 'Bookmark post' });
    expect(save).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(<PostActions {...baseProps} onSave={onSave} saved />);
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables a control while its request is in flight', () => {
    render(<PostActions {...baseProps} onSave={() => {}} likeBusy saveBusy />);

    expect(screen.getByRole('button', { name: 'Like post' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bookmark post' })).toBeDisabled();
  });

  it('stops click propagation so the card navigation is not triggered', async () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <PostActions {...baseProps} onComment={() => {}} />
      </div>
    );

    await userEvent.click(screen.getByRole('button', { name: 'View 2 comments' }));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
