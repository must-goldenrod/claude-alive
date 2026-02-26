# Unified Layout Redesign

## Problem
- Cards too tight, no internal padding, text feels cramped
- Dashboard/3D/Pixel are separate views — dashboard info not visible in 3D/Pixel
- Top StatsBar is unnecessary

## Design

### Layout: 3-Column Unified View

```
[Top Bar: logo, connection, 3D/Pixel toggle, lang]
[Left 240px] | [Center flex-1] | [Right 280px]
[NotificationBanner - bottom overlay when needed]
```

### Left Sidebar (240px)
- Project list as vertical accordion (collapse/expand per project)
- Each project shows agent cards in single column
- Compact agent cards: name, state, current tool, last activity
- Improved padding (p-4, gap-2)

### Center Body (flex-1)
- 3D Field or Pixel Office canvas fills entire area
- Toggle via icon buttons in top bar
- No split panel — canvas only

### Right Sidebar (280px)
- Top: ActivityPulse (adapted to vertical layout)
- Bottom: EventStream (fills remaining space, scrollable)

### Removed
- StatsBar (events, events/min, active, top tool)
- Separate view system (dashboard/3d/pixel tabs)
- Resizable split panels in 3D/Pixel views

### Card Improvements
- Internal padding: p-2 → p-4
- Text spacing: gap-1 → gap-2
- More breathing room throughout
