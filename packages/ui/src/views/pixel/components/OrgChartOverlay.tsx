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

const NODE_WIDTH = 136;
const NODE_HEIGHT = 56;
const H_GAP = 16;
const V_GAP = 40;
const PADDING = 24;
const HEADER_HEIGHT = 36;

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
          top: 12,
          left: 12,
          zIndex: 20,
          width: 32,
          height: 32,
          background: open ? 'rgba(68, 138, 255, 0.3)' : 'rgba(20, 20, 35, 0.8)',
          border: `1px solid ${open ? '#448aff' : '#333348'}`,
          borderRadius: 6,
          color: '#e0e0e8',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          transition: 'background 0.15s, border-color 0.15s',
        }}
        title="Agent Hierarchy"
      >
        &#x229E;
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: 12,
            zIndex: 20,
            width: panelWidth,
            maxHeight: 'calc(100% - 80px)',
            background: 'rgba(10, 10, 20, 0.92)',
            border: '1px solid #333348',
            borderRadius: 8,
            overflow: 'auto',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid #2a2a3a',
            fontSize: 12,
            fontWeight: 'bold',
            color: '#8888a0',
          }}>
            <span>Agent Hierarchy</span>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#8888a0',
                cursor: 'pointer',
                fontSize: 14,
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
