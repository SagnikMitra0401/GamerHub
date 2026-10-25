import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SegmentedTabs from './SegmentedTabs';

const options = [
  { key: 'global', label: 'Global' },
  { key: 'following', label: 'Following' },
  { key: 'latest', label: 'Latest' }
];

const renderTabs = (props = {}) =>
  render(<SegmentedTabs ariaLabel="Sort posts" options={options} value="global" onChange={() => {}} {...props} />);

afterEach(() => {
  delete globalThis.ResizeObserver;
});

describe('SegmentedTabs', () => {
  it('renders one button per option in a labelled group', () => {
    renderTabs();

    expect(screen.getByRole('group', { name: 'Sort posts' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(options.length);
    options.forEach(option => expect(screen.getByRole('button', { name: option.label })).toBeInTheDocument());
  });

  it('marks exactly the active tab as pressed', () => {
    renderTabs({ value: 'following' });

    expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Following' })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: 'Global' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the clicked key and nothing else', async () => {
    const onChange = vi.fn();
    renderTabs({ onChange });

    await userEvent.click(screen.getByRole('button', { name: 'Latest' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('latest');
  });

  it('works from the keyboard alone', async () => {
    const onChange = vi.fn();
    renderTabs({ onChange });

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Global' })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');   // native button order, no custom handler
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Following' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('following');

    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps a hidden indicator node and enables transitions after the first frame', async () => {
    const { container, rerender } = renderTabs();
    const tray = container.querySelector('.seg-tray');

    expect(container.querySelector('.seg-indicator')).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() => expect(tray).toHaveClass('is-ready'));

    // A size change (the compact nav) must not remount the pill or lose state.
    rerender(<SegmentedTabs ariaLabel="Sort posts" value="latest" onChange={() => {}} options={options} size="sm" />);
    expect(container.querySelector('.seg-tray')).toHaveClass('seg-tray--sm');
    expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders without an active tab when the value matches nothing', () => {
    renderTabs({ value: 'deleted-tab' });

    screen.getAllByRole('button').forEach(button => {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('observes the tray for resizes and disconnects on unmount', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      constructor() { this.observe = observe; this.disconnect = disconnect; }
    };

    const { unmount } = renderTabs();

    expect(observe).toHaveBeenCalledTimes(options.length + 1);   // tray + every button
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
