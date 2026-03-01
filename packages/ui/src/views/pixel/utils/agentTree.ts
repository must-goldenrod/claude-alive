import type { AgentInfo } from '@claude-alive/core';

export interface AgentTreeNode {
  agent: AgentInfo;
  children: AgentTreeNode[];
}

export function buildAgentTree(agents: AgentInfo[]): AgentTreeNode[] {
  const byId = new Map<string, AgentTreeNode>();
  const roots: AgentTreeNode[] = [];

  for (const agent of agents) {
    byId.set(agent.sessionId, { agent, children: [] });
  }

  for (const node of byId.values()) {
    const parentId = node.agent.parentId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
