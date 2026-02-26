import { useCallback } from 'react';
import { Graphics } from 'pixi.js';
import { useApplication } from '@pixi/react';
import { BG_COLOR } from '../engine/constants.ts';

/**
 * Procedural background: dark gradient + geometric furniture silhouettes.
 * Rendered as PixiJS Graphics in the background layer.
 */
export function SceneBackground() {
  const { app } = useApplication();

  const draw = useCallback(
    (g: Graphics) => {
      const w = app.screen.width;
      const h = app.screen.height;

      g.clear();

      // Base gradient (top dark, bottom slightly lighter)
      g.rect(0, 0, w, h);
      g.fill(BG_COLOR);

      // Floor gradient overlay
      g.rect(0, h * 0.6, w, h * 0.4);
      g.fill({ color: 0x16213e, alpha: 0.5 });

      // Window (bright rectangle on upper-left)
      const winX = w * 0.05;
      const winY = h * 0.05;
      const winW = w * 0.18;
      const winH = h * 0.35;
      g.roundRect(winX, winY, winW, winH, 4);
      g.fill({ color: 0x2a3a5c, alpha: 0.6 });
      // Window glow
      g.roundRect(winX + 4, winY + 4, winW - 8, winH - 8, 2);
      g.fill({ color: 0x3a5080, alpha: 0.3 });

      // Desk silhouette (center-bottom)
      const deskW = w * 0.5;
      const deskH = h * 0.06;
      const deskX = (w - deskW) / 2;
      const deskY = h * 0.82;
      g.roundRect(deskX, deskY, deskW, deskH, 3);
      g.fill({ color: 0x12121e, alpha: 0.7 });

      // Shelf silhouette (right wall)
      const shelfX = w * 0.82;
      const shelfY = h * 0.15;
      const shelfW = w * 0.12;
      g.roundRect(shelfX, shelfY, shelfW, h * 0.04, 2);
      g.fill({ color: 0x12121e, alpha: 0.5 });
      g.roundRect(shelfX, shelfY + h * 0.12, shelfW, h * 0.04, 2);
      g.fill({ color: 0x12121e, alpha: 0.5 });
      g.roundRect(shelfX, shelfY + h * 0.24, shelfW, h * 0.04, 2);
      g.fill({ color: 0x12121e, alpha: 0.5 });

      // Ambient floor line
      g.moveTo(0, h * 0.88);
      g.lineTo(w, h * 0.88);
      g.stroke({ color: 0x2a2a4a, width: 1, alpha: 0.4 });
    },
    [app.screen.width, app.screen.height],
  );

  return <pixiGraphics draw={draw} />;
}
