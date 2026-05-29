import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Minimal stand-in for HTMLAudioElement. jsdom does not implement media
 * playback (`play()` throws "Not implemented"), so we stub the global `Audio`
 * constructor and record every interaction the sound service performs.
 */
class FakeAudio {
  static created: FakeAudio[] = [];
  src: string;
  volume = 1;
  muted = false;
  currentTime = 0;
  preload = '';
  paused = true;
  playCalls = 0;

  constructor(src?: string) {
    this.src = src ?? '';
    FakeAudio.created.push(this);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

/** Re-import the module graph fresh so singleton state (cached elements, dedupe
 * map, unlock flag, settings) is reset between tests. The two imports share the
 * same reset registry, so `sound`'s `getSettings` reads the same singleton that
 * `settings.setSettings` mutates. */
async function loadSound() {
  vi.resetModules();
  const settings = await import('../services/settings');
  const sound = await import('../services/sound');
  return { sound, settings };
}

/** Total number of `play()` calls across every audio element created so far. */
function totalPlays(): number {
  return FakeAudio.created.reduce((sum, a) => sum + a.playCalls, 0);
}

beforeEach(() => {
  FakeAudio.created = [];
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sound service', () => {
  it('plays the completion sound when enabled', async () => {
    const { sound } = await loadSound();
    sound.playCompletionSound('s1');
    expect(totalPlays()).toBe(1);
    const played = FakeAudio.created.find(a => a.playCalls > 0)!;
    expect(played.volume).toBeCloseTo(0.7);
    expect(played.muted).toBe(false);
  });

  it('does not play the completion sound when disabled', async () => {
    const { sound, settings } = await loadSound();
    settings.setSettings(prev => ({
      ...prev,
      sound: { ...prev.sound, completion: { enabled: false, volume: 0.7 } },
    }));
    sound.playCompletionSound('s1');
    expect(totalPlays()).toBe(0);
  });

  it('does not play when volume is zero', async () => {
    const { sound, settings } = await loadSound();
    settings.setSettings(prev => ({
      ...prev,
      sound: { ...prev.sound, completion: { enabled: true, volume: 0 } },
    }));
    sound.playCompletionSound('s1');
    expect(totalPlays()).toBe(0);
  });

  it('debounces repeated plays for the same session', async () => {
    const { sound } = await loadSound();
    sound.playCompletionSound('s1');
    sound.playCompletionSound('s1');
    expect(totalPlays()).toBe(1);
  });

  it('plays separately for different sessions', async () => {
    const { sound } = await loadSound();
    sound.playCompletionSound('s1');
    sound.playCompletionSound('s2');
    expect(totalPlays()).toBe(2);
  });

  it('allows replay after the debounce window elapses', async () => {
    const { sound } = await loadSound();
    vi.useFakeTimers();
    try {
      sound.playCompletionSound('s1');
      vi.advanceTimersByTime(900);
      sound.playCompletionSound('s1');
      expect(totalPlays()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses one element per sound kind (Safari autoplay requirement)', async () => {
    const { sound } = await loadSound();
    sound.playCompletionSound('s1');
    sound.playCompletionSound('s2');
    // Both completion plays must go through a single audio element.
    expect(FakeAudio.created.length).toBe(1);
  });

  it('unlocks audio on the first user gesture', async () => {
    const { sound } = await loadSound();
    expect(sound.isAudioUnlocked()).toBe(false);
    sound.installAudioUnlock();
    window.dispatchEvent(new Event('pointerdown'));
    expect(sound.isAudioUnlocked()).toBe(true);
    // Priming plays both completion and error elements (muted) within the gesture.
    expect(FakeAudio.created.filter(a => a.playCalls > 0).length).toBe(2);
  });

  it('does not re-unlock on subsequent gestures', async () => {
    const { sound } = await loadSound();
    sound.installAudioUnlock();
    window.dispatchEvent(new Event('pointerdown'));
    const afterFirst = totalPlays();
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    expect(totalPlays()).toBe(afterFirst);
  });

  it('plays the error sound for resource alerts at the given volume', async () => {
    const { sound } = await loadSound();
    sound.playResourceAlertSound(0.5);
    expect(totalPlays()).toBe(1);
    expect(FakeAudio.created.find(a => a.playCalls > 0)!.volume).toBeCloseTo(0.5);
  });

  it('test sound plays even when that sound type is disabled', async () => {
    const { sound, settings } = await loadSound();
    settings.setSettings(prev => ({
      ...prev,
      sound: { ...prev.sound, completion: { enabled: false, volume: 0.4 } },
    }));
    sound.playTestSound('completion', 0.4);
    expect(totalPlays()).toBe(1);
    expect(FakeAudio.created.find(a => a.playCalls > 0)!.volume).toBeCloseTo(0.4);
  });
});
