import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ChatSkeleton,
  PostListSkeleton,
  ProfileSkeleton,
  SettingsSkeleton
} from './Skeleton';

/**
 * Skeletons are decorative boxes, so the only meaningful contract is:
 * one labelled status region, the right number of placeholder cards, and no
 * text that a screen reader would read out as content.
 */
describe('Skeleton placeholders', () => {
  it('announces one loading status instead of every box', () => {
    render(<PostListSkeleton count={4} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAccessibleName('Loading posts');
    expect(status.querySelectorAll('.skel-card')).toHaveLength(4);
  });

  it('labels the region it replaces for each composition', () => {
    const { unmount } = render(<ProfileSkeleton />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading profile');
    unmount();

    render(<ChatSkeleton />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading messages');
  });

  it('keeps placeholders out of the accessibility tree', () => {
    const { container } = render(<SettingsSkeleton />);
    expect(container.querySelectorAll('.skel[aria-hidden="true"]').length).toBeGreaterThan(5);
  });
});
