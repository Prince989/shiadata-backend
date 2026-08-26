/**
 * Story graph helpers used by the storytelling skeleton.
 * Full authoring UI is out of scope; publish-time validation is not.
 */

export type NodeType = 'scene' | 'choice' | 'ending';

export interface StoryOption {
  optionId: string;
  label: string;
  nextNodeId: string;
  isHistorical?: boolean;
}

export interface StoryNode {
  nodeId: string;
  nodeType: NodeType;
  text: string;
  options: StoryOption[];
}

export interface StoryDraft {
  storyId: string;
  entryNodeId: string;
  nodes: StoryNode[];
}

export function validateStoryGraph(story: StoryDraft): string[] {
  const errors: string[] = [];
  const ids = new Set(story.nodes.map((n) => n.nodeId));
  if (!ids.has(story.entryNodeId)) {
    errors.push(`entryNodeId ${story.entryNodeId} does not exist`);
  }
  const seen = new Set<string>();
  for (const node of story.nodes) {
    if (seen.has(node.nodeId)) errors.push(`duplicate nodeId ${node.nodeId}`);
    seen.add(node.nodeId);
    if (node.nodeType === 'ending' && node.options.length > 0) {
      errors.push(`ending ${node.nodeId} must not have options`);
    }
    for (const option of node.options) {
      if (!ids.has(option.nextNodeId)) {
        errors.push(
          `option ${option.optionId} points at missing node ${option.nextNodeId}`,
        );
      }
    }
  }
  const reachable = new Set<string>();
  const stack = [story.entryNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = story.nodes.find((n) => n.nodeId === id);
    node?.options.forEach((o) => stack.push(o.nextNodeId));
  }
  for (const id of ids) {
    if (!reachable.has(id)) errors.push(`unreachable node ${id}`);
  }
  if (![...reachable].some((id) => story.nodes.find((n) => n.nodeId === id)?.nodeType === 'ending')) {
    errors.push('story has no reachable ending');
  }
  return errors;
}
