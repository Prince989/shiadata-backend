import { validateStoryGraph, StoryDraft } from './story-graph';

describe('validateStoryGraph', () => {
  const ok: StoryDraft = {
    storyId: 'khandaq',
    entryNodeId: 'start',
    nodes: [
      {
        nodeId: 'start',
        nodeType: 'scene',
        text: 'خندق',
        options: [{ optionId: 'a', label: 'ادامه', nextNodeId: 'end' }],
      },
      { nodeId: 'end', nodeType: 'ending', text: 'پایان', options: [] },
    ],
  };

  it('accepts a reachable graph with an ending', () => {
    expect(validateStoryGraph(ok)).toEqual([]);
  });

  it('rejects a dangling choice edge', () => {
    const broken = structuredClone(ok);
    broken.nodes[0]!.options[0]!.nextNodeId = 'missing';
    expect(validateStoryGraph(broken).join(' ')).toMatch(/missing/);
  });

  it('rejects a graph with no reachable ending', () => {
    const loop: StoryDraft = {
      storyId: 'loop',
      entryNodeId: 'a',
      nodes: [
        {
          nodeId: 'a',
          nodeType: 'choice',
          text: 'x',
          options: [{ optionId: '1', label: 'again', nextNodeId: 'a' }],
        },
      ],
    };
    expect(validateStoryGraph(loop).join(' ')).toMatch(/ending/);
  });
});
