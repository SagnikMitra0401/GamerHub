import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StoryViewer from './StoryViewer';

vi.mock('../../api/axiosInstance', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const videoUrl = 'https://res.cloudinary.com/demo/video/upload/c_limit,q_auto,w_1280/v1/story.mp4';
const group = {
  isOwn: true,
  author: { _id: 'u1', username: 'author' },
  stories: [
    {
      _id: 's1',
      kind: 'video',
      mediaUrl: videoUrl,
      caption: 'story caption',
      createdAt: new Date().toISOString(),
      background: 'aurora',
    },
  ],
};

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('StoryViewer video delivery', () => {
  it('uses the transformed video URL and its derived poster', () => {
    const { container } = render(
      <MemoryRouter>
        <StoryViewer groups={[group]} startGroup={0} startStory={0} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(container.querySelector('.story-viewer-author')).toHaveAttribute('href', '/u/author');

    const video = container.querySelector('.story-viewer video');
    expect(video).toHaveAttribute('src', videoUrl);
    expect(video).toHaveAttribute(
      'poster',
      'https://res.cloudinary.com/demo/video/upload/so_0,w_640,c_limit,q_auto/c_limit,q_auto,w_1280/v1/story.jpg',
    );
  });
});
