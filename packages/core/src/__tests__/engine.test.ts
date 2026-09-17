import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENGINE_SETTINGS,
  DEFAULT_GATEWAY_PRESET_MODELS,
  isValidGatewayModelId,
  normalizeEngineSettings,
  resolveGatewayModel,
} from '../tickets/engine.js';
import { TICKET_RUN_PRESET_IDS } from '../tickets/runProfile.js';

describe('engine settings', () => {
  it('defaults to the Claude engine with glm-5.3 mapped for the gateway', () => {
    expect(DEFAULT_ENGINE_SETTINGS.engine).toBe('claude');
    expect(DEFAULT_GATEWAY_PRESET_MODELS.fast).toBe('glm-5.3-flash');
    for (const id of TICKET_RUN_PRESET_IDS.filter((p) => p !== 'fast')) {
      expect(DEFAULT_GATEWAY_PRESET_MODELS[id]).toBe('glm-5.3');
    }
  });

  it('covers every run preset', () => {
    expect(Object.keys(DEFAULT_GATEWAY_PRESET_MODELS).sort()).toEqual([...TICKET_RUN_PRESET_IDS].sort());
  });

  it('normalizes unknown engines and invalid models to defaults', () => {
    const s = normalizeEngineSettings({
      engine: 'openai',
      presetModels: { fast: 'gemini/gemini-3.7-flash', deep: 'x; rm -rf /', standard: '' },
    });
    expect(s.engine).toBe('claude');
    expect(s.presetModels.fast).toBe('gemini/gemini-3.7-flash');
    expect(s.presetModels.deep).toBe('glm-5.3');
    expect(s.presetModels.standard).toBe('glm-5.3');
    expect(normalizeEngineSettings(null)).toEqual(DEFAULT_ENGINE_SETTINGS);
    expect(normalizeEngineSettings({ engine: 'gateway' }).engine).toBe('gateway');
  });

  it('accepts real gateway ids and rejects shell metacharacters', () => {
    for (const id of ['glm-5.3', 'gemini/gemini-3.7-flash', 'vendor:model@rev', 'kimi-k2.7-code']) {
      expect(isValidGatewayModelId(id)).toBe(true);
    }
    for (const id of ['', '-flag', 'a b', "a'b", 'a;b', '$(x)', 'x'.repeat(129)]) {
      expect(isValidGatewayModelId(id)).toBe(false);
    }
  });

  it('resolves an explicit pick, then the preset mapping, then standard', () => {
    const settings = normalizeEngineSettings({ engine: 'gateway', presetModels: { deep: 'kimi-k3' } });
    expect(resolveGatewayModel(settings, 'deep', 'grok-4.6')).toBe('grok-4.6');
    expect(resolveGatewayModel(settings, 'deep', 'bad model')).toBe('kimi-k3');
    expect(resolveGatewayModel(settings, 'fast')).toBe('glm-5.3-flash');
    expect(resolveGatewayModel(settings, undefined)).toBe('glm-5.3');
  });
});
