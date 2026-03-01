import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Application, Container } from 'pixi.js';
import { MODEL_NAMES, modelPath, BG_COLOR } from '../views/bishoujo/engine/constants.ts';
import type { ModelName } from '../views/bishoujo/engine/constants.ts';

// Ensure window.PIXI is set
import '../views/bishoujo/engine/live2dManager.ts';
import { Live2DModel } from '@naari3/pixi-live2d-display';

interface ModelCardProps {
  name: ModelName;
}

function ModelCard({ name }: ModelCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let destroyed = false;
    const app = new Application();
    appRef.current = app;

    (async () => {
      try {
        await app.init({
          canvas,
          width: 280,
          height: 360,
          backgroundAlpha: 1,
          backgroundColor: BG_COLOR,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });

        if (destroyed) return;

        const model = await Live2DModel.from(modelPath(name), {
          autoHitTest: false,
          autoFocus: false,
          autoUpdate: true,
        });

        if (destroyed) {
          model.destroy();
          return;
        }

        // Patch draw for Retina viewport
        const im = (model as any).internalModel;
        if (im) {
          const origDraw = im.draw.bind(im);
          im.draw = (gl: WebGLRenderingContext) => {
            const s = im.drawingManager ?? im;
            const origSet = s.setRenderState?.bind(s);
            if (origSet) {
              s.setRenderState = (fbo: any, vp: number[]) => {
                vp[2] = gl.canvas.width;
                vp[3] = gl.canvas.height;
                origSet(fbo, vp);
              };
            }
            origDraw(gl);
            if (origSet) s.setRenderState = origSet;
          };
        }

        const container = new Container();
        container.addChild(model);

        // Scale to fit the card canvas
        const scale = 0.12;
        model.scale.set(scale, scale);
        model.anchor.set(0.5, 0.87);
        model.x = 280 / 2;
        model.y = 360 * 0.85;

        app.stage.addChild(container);
        setLoading(false);
      } catch {
        if (!destroyed) setError(true);
        setLoading(false);
      }
    })();

    return () => {
      destroyed = true;
      app.destroy(true);
      appRef.current = null;
    };
  }, [name]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        overflow: 'hidden',
        width: 280,
      }}
    >
      <div style={{ position: 'relative', width: 280, height: 360 }}>
        <canvas
          ref={canvasRef}
          style={{ width: 280, height: 360, display: 'block' }}
        />
        {loading && !error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              fontSize: 12,
            }}
          >
            Loading...
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#e74c3c',
              fontSize: 12,
            }}
          >
            Failed to load
          </div>
        )}
      </div>
      <div
        style={{
          padding: '10px 0 12px',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
        }}
      >
        {name}
      </div>
    </div>
  );
}

interface ModelGalleryProps {
  onClose: () => void;
}

export function ModelGallery({ onClose }: ModelGalleryProps) {
  const { t } = useTranslation();

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          marginTop: 60,
          marginBottom: 40,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {t('gallery.title')}
          </h2>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            {t('gallery.count', { count: MODEL_NAMES.length })}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 20,
            justifyContent: 'center',
            maxWidth: 960,
            padding: '0 20px',
          }}
        >
          {MODEL_NAMES.map((name) => (
            <ModelCard key={name} name={name} />
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 8,
            height: 36,
            padding: '0 24px',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            color: '#fff',
            background: 'rgba(255,255,255,0.1)',
          }}
        >
          {t('gallery.close')}
        </button>
      </div>
    </div>
  );
}
