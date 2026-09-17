import '@testing-library/jest-dom/vitest';
import i18n from '@claude-alive/i18n';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSettings } from '@claude-alive/core';
import { EngineSettingsForm } from '../components/EngineSettingsForm.tsx';
import { NewTicketForm } from '../views/tickets/NewTicketForm.tsx';
import { applyEngineUpdate, setEngineState } from '../services/engineSettings.ts';

const MODELS = { fast: 'glm-5.3-flash', medium: 'glm-5.3', standard: 'glm-5.3', deep: 'glm-5.3', expert: 'glm-5.3', ultimate: 'glm-5.3' };
const CLAUDE: EngineSettings = { engine: 'claude', presetModels: MODELS };
const GATEWAY: EngineSettings = { engine: 'gateway', presetModels: MODELS };

function stubFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const path = new URL(url).pathname;
      const route = routes[`${method} ${path}`];
      if (!route) return { ok: false, status: 404, json: async () => ({}) } as Response;
      return { ok: (route.status ?? 200) < 400, status: route.status ?? 200, json: async () => route.body } as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  setEngineState(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EngineSettingsForm', () => {
  it('switches to the gateway engine with an edited preset model', async () => {
    const calls = stubFetch({
      'GET /api/settings/engine': { body: { settings: CLAUDE, gatewayConfigured: true } },
      'GET /api/settings/engine/models': { body: { ok: true, models: ['glm-5.3', 'glm-5.3-flash', 'kimi-k3'] } },
      'POST /api/settings/engine': {
        body: { settings: { engine: 'gateway', presetModels: { ...MODELS, deep: 'kimi-k3' } }, gatewayConfigured: true },
      },
    });
    render(<EngineSettingsForm active />);
    const save = await screen.findByTestId('engine-save');
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByTestId('engine-option-gateway'));
    await screen.findAllByRole('option', { name: 'kimi-k3' });
    fireEvent.change(screen.getByLabelText(new RegExp(i18n.t('tickets.preset.deep'))), { target: { value: 'kimi-k3' } });
    fireEvent.click(save);

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      engine: 'gateway',
      presetModels: { ...MODELS, deep: 'kimi-k3' },
    });
    expect(await screen.findByTestId('engine-current')).toHaveTextContent(i18n.t('settings.backend.engine.option.gateway'));
  });

  it('blocks the gateway engine until a gateway is connected', async () => {
    stubFetch({
      'GET /api/settings/engine': { body: { settings: CLAUDE, gatewayConfigured: false } },
      'GET /api/settings/engine/models': { body: { ok: false, error: 'gateway not configured' } },
    });
    render(<EngineSettingsForm active />);
    fireEvent.click(await screen.findByTestId('engine-option-gateway'));
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('settings.backend.engine.needsGateway'));
    expect(screen.getByTestId('engine-save')).toBeDisabled();
  });
});

describe('NewTicketForm on the gateway engine', () => {
  function submit() {
    fireEvent.change(screen.getByPlaceholderText(i18n.t('tickets.newGoalPlaceholder')), { target: { value: '작업' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('tickets.create') }));
  }

  it('labels presets with the Claude models and sends no model on the Claude engine', async () => {
    stubFetch({ 'GET /api/settings/engine': { body: { settings: CLAUDE, gatewayConfigured: true } } });
    const onCreate = vi.fn(async () => null);
    render(<NewTicketForm onCreate={onCreate} presetCwd="/r/alive" />);
    await waitFor(() => expect(screen.getAllByText(/Opus 5 · high/).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('ticket-gateway-model')).toBeNull();
    submit();
    expect(onCreate).toHaveBeenCalledWith('작업', '/r/alive', undefined, true, 'standard', true, true, undefined);
  });

  it('keeps the Claude presets when the engine API answers something unexpected', async () => {
    stubFetch({ 'GET /api/settings/engine': { body: {} } });
    render(<NewTicketForm onCreate={vi.fn(async () => null)} presetCwd="/r/alive" />);
    await waitFor(() => expect(screen.getAllByText(/Opus 5 · high/).length).toBeGreaterThan(0));
    act(() => applyEngineUpdate({} as EngineSettings));
    expect(screen.queryByTestId('ticket-gateway-model')).toBeNull();
  });

  it('labels presets with gateway models, follows engine:update live, and sends a direct pick', async () => {
    stubFetch({
      'GET /api/settings/engine': { body: { settings: CLAUDE, gatewayConfigured: true } },
      'GET /api/settings/engine/models': { body: { ok: true, models: ['glm-5.3', 'grok-4.6'] } },
    });
    const onCreate = vi.fn(async () => null);
    render(<NewTicketForm onCreate={onCreate} presetCwd="/r/alive" />);
    await waitFor(() => expect(screen.getAllByText(/Opus 5 · high/).length).toBeGreaterThan(0));

    // Another dashboard saved the gateway engine: the open form re-labels itself.
    act(() => applyEngineUpdate(GATEWAY));
    expect(await screen.findByText('glm-5.3-flash · low')).toBeInTheDocument();
    expect(screen.getAllByText('glm-5.3 · high').length).toBeGreaterThan(0);
    expect(screen.getByTestId('ticket-gateway-model')).toBeInTheDocument();

    await screen.findByRole('option', { name: 'grok-4.6' });
    fireEvent.change(screen.getByLabelText(i18n.t('tickets.modelPick')), { target: { value: 'grok-4.6' } });
    submit();
    expect(onCreate).toHaveBeenCalledWith('작업', '/r/alive', undefined, true, 'standard', true, true, 'grok-4.6');
  });
});
