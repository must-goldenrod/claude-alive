# Pixel Office Improvements Design

## 6 Changes

### 1. Main vs Sub-agent distinction
- Sub-agents render at 75% scale with striped shirt pattern
- Character gets `isSubAgent` boolean field
- Separate sprite variant for sub-agents

### 2. Sub-agent name labels
- Character gets `label` field (displayName)
- Render text above head: semi-transparent black bg + white text
- Only shown for sub-agents with a displayName

### 3. Click info tooltip (minimal)
- Remove crosshair cursor, use default
- Hit-test characters on click via screenToWorld
- Show name + current tool in rounded rect bubble above character
- Toggle: click same = close, click empty = close
- Selected character tracked in OfficeState.selectedCharacterId

### 4. Double size
- TILE_SIZE: 16 → 32
- CHAR_WIDTH: 16 → 32, CHAR_HEIGHT: 32 → 64
- DEFAULT_ZOOM: 3 → 2
- All sprite drawing coordinates scaled 2x
- DEFAULT_COLS: 20, DEFAULT_ROWS: 12 (unchanged)

### 5. Office furniture rendering
- New tile types: DESK (3), CHAIR (4), COMPUTER (5)
- DESK: brown wood texture with highlight
- CHAIR: dark seat on floor tiles (rendered as object on floor)
- COMPUTER: monitor + keyboard on desk surface
- 4 desk clusters in office layout

### 6. Zone-based agent placement
- Seat gets `zone` field ('A'|'B'|'C'|'D')
- Agents placed in zone matching their cwd/project
- Same project = same desk cluster
- Overflow to next zone if full
