import { Composition, registerRoot } from 'remotion';
import type { CompositionInput } from './contracts.js';
import { StoryComposition } from './composition.js';

const emptyId = '00000000-0000-4000-8000-000000000001';
const defaults: CompositionInput = {
  manifest: {
    version: 1, templateId: 'RedditStory', templateVersion: 1, width: 1080, height: 1920, fps: 30, durationFrames: 30,
    storyProjectId: emptyId, storyVersionId: emptyId, storyVersion: 1, platform: 'MANUAL', sourcePostId: emptyId,
    title: 'Short story preview', backgroundAssetId: null, attribution: { required: false, text: null },
    visualSettings: { theme: 'dark', anonymizeAuthors: true, showEngagement: false }, audioAssets: [], subtitlePreset: 'ClassicCaption',
    subtitleTimeline: [], visualSegments: [{ id: 'preview', type: 'INTRO', text: 'Story preview', sourceRefs: [], narrationType: 'ORIGINAL_COMMENTARY', startFrame: 0, endFrame: 30 }],
    animations: ['FADE', 'SLIDE', 'SCALE', 'SEQUENTIAL_COMMENTS'], audioLevels: { narration: 1, background: 0 },
    rendering: { videoCodec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p' },
  },
  post: { title: null, body: '', authorAlias: null }, comments: [], backgroundSrc: null, audioSources: {},
};

function Root() {
  return <Composition id="ShortVideo" component={StoryComposition} width={1080} height={1920} fps={30} durationInFrames={30} defaultProps={defaults}
    calculateMetadata={({ props }) => ({ durationInFrames: props.manifest.durationFrames })} />;
}

registerRoot(Root);
