interface LineConnection {
  parentId: string;
  childId: string;
}

interface OrgChartLinesProps {
  connections: LineConnection[];
  nodePositions: Map<string, { x: number; y: number; width: number; height: number }>;
  containerRect: { width: number; height: number };
}

export function OrgChartLines({ connections, nodePositions, containerRect }: OrgChartLinesProps) {
  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: containerRect.width,
        height: containerRect.height,
        pointerEvents: 'none',
      }}
    >
      {connections.map(({ parentId, childId }) => {
        const parent = nodePositions.get(parentId);
        const child = nodePositions.get(childId);
        if (!parent || !child) return null;

        const x1 = parent.x + parent.width / 2;
        const y1 = parent.y + parent.height;
        const x2 = child.x + child.width / 2;
        const y2 = child.y;

        return (
          <line
            key={`${parentId}-${childId}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#555570"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        );
      })}
    </svg>
  );
}
