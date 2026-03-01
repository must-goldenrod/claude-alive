import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { AgentInfo } from '@claude-alive/core';
import type { Character } from '../engine/character';
import { buildAgentTree } from '../utils/agentTree';
import type { AgentTreeNode } from '../utils/agentTree';
import { AgentNode } from './AgentNode';
import { OrgChartLines } from './OrgChartLines';
import { TILE_SIZE } from '../engine/constants';
import type { Camera } from '../engine/camera';

interface OrgChartOverlayProps {
  agents: AgentInfo[];
  characters: Map<string, Character>;
  camera: React.MutableRefObject<Camera>;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;
const H_GAP = 20;
const V_GAP = 44;
const PADDING = 28;
const HEADER_HEIGHT = 44;

function treeWidth(node: AgentTreeNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + treeWidth(c), 0);
}

function forestWidth(roots: AgentTreeNode[]): number {
  return roots.reduce((sum, r) => sum + treeWidth(r), 0);
}

interface LayoutNode {
  sessionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

function layoutTree(
  node: AgentTreeNode,
  depth: number,
  offsetX: number,
): LayoutNode[] {
  const result: LayoutNode[] = [];
  const w = treeWidth(node);
  const myX = offsetX + (w * (NODE_WIDTH + H_GAP) - H_GAP) / 2 - NODE_WIDTH / 2;
  const myY = HEADER_HEIGHT + PADDING + depth * (NODE_HEIGHT + V_GAP);

  result.push({
    sessionId: node.agent.sessionId,
    x: myX,
    y: myY,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    parentId: node.agent.parentId,
  });

  let childOffset = offsetX;
  for (const child of node.children) {
    result.push(...layoutTree(child, depth + 1, childOffset));
    childOffset += treeWidth(child) * (NODE_WIDTH + H_GAP);
  }

  return result;
}

function layoutForest(roots: AgentTreeNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  let offsetX = PADDING;
  for (const root of roots) {
    result.push(...layoutTree(root, 0, offsetX));
    offsetX += treeWidth(root) * (NODE_WIDTH + H_GAP);
  }
  return result;
}

export function OrgChartOverlay({ agents, characters, camera }: OrgChartOverlayProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildAgentTree(agents), [agents]);
  const layout = useMemo(() => layoutForest(tree), [tree]);

  const totalTreeWidth = forestWidth(tree) * (NODE_WIDTH + H_GAP) - H_GAP + PADDING * 2;
  const maxDepth = layout.reduce((max, n) => Math.max(max, n.y), 0);
  const panelWidth = Math.max(300, Math.min(totalTreeWidth, 600));
  const panelHeight = maxDepth + NODE_HEIGHT + PADDING * 2;

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const n of layout) {
      map.set(n.sessionId, { x: n.x, y: n.y, width: n.width, height: n.height });
    }
    return map;
  }, [layout]);

  const connections = useMemo(() => {
    return layout
      .filter(n => n.parentId !== null)
      .map(n => ({ parentId: n.parentId!, childId: n.sessionId }));
  }, [layout]);

  const handleNodeClick = useCallback((sessionId: string) => {
    const char = characters.get(sessionId);
    if (!char) return;
    camera.current = {
      ...camera.current,
      x: char.tileX * TILE_SIZE + TILE_SIZE / 2,
      y: char.tileY * TILE_SIZE + TILE_SIZE / 2,
    };
    setOpen(false);
  }, [characters, camera]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (agents.length === 0) return null;

  return (
    <div ref={containerRef}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 20,
          width: 36,
          height: 36,
          background: open ? 'rgba(88, 166, 255, 0.25)' : 'rgba(22, 27, 34, 0.85)',
          border: `1px solid ${open ? 'var(--accent-blue)' : 'var(--border-color)'}`,
          borderRadius: 10,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          transition: 'all 0.2s ease',
        }}
        title="Agent Hierarchy"
      >
        &#x229E;
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 16,
            zIndex: 20,
            width: panelWidth,
            maxHeight: 'calc(100% - 90px)',
            background: 'rgba(13, 17, 23, 0.95)',
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            overflow: 'auto',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-secondary)',
          }}>
            <span>Agent Hierarchy</span>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              &#x2715;
            </button>
          </div>

          <div style={{ position: 'relative', minHeight: panelHeight }}>
            <OrgChartLines
              connections={connections}
              nodePositions={nodePositions}
              containerRect={{ width: panelWidth, height: panelHeight }}
            />
            {layout.map(n => (
              <div
                key={n.sessionId}
                style={{
                  position: 'absolute',
                  left: n.x,
                  top: n.y,
                  width: n.width,
                }}
              >
                <AgentNode
                  agent={agents.find(a => a.sessionId === n.sessionId)!}
                  character={characters.get(n.sessionId)}
                  onClick={handleNodeClick}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
