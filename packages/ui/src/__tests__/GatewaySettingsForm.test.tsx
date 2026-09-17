import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GatewaySettingsForm } from '../components/GatewaySettingsForm.tsx';

const saved = {
  baseUrl: 'http://localhost:4000',
  hasKey: true,
  keyHint: '…a1b2',
  defaultModel: 'fast-model',
  hasModelsFile: true,
  active: true,
};

function stubFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const path = new URL(url).pathname;
      const route = routes[`${method} ${path}`];
      if (!route) throw new Error(`unexpected ${method} ${path}`);
      return { ok: (route.status ?? 200) < 400, status: route.status ?? 200, json: async () => route.body } as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GatewaySettingsForm', () => {
  it('shows the saved gateway without ever receiving the key', async () => {
    stubFetch({ 'GET /api/settings/gateway': { body: saved } });
    render(<GatewaySettingsForm active />);
    await waitFor(() => expect(screen.getByLabelText(/URL/)).toHaveValue('http://localhost:4000'));
    expect(screen.getByTestId('gateway-status')).toHaveTextContent(/연결됨|Connected/);
    expect((screen.getByLabelText(/API/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/API/) as HTMLInputElement).placeholder).toContain('…a1b2');
  });

  it('tests the connection, then saves with the chosen default model', async () => {
    const calls = stubFetch({
      'GET /api/settings/gateway': { body: { ...saved, baseUrl: null, hasKey: false, keyHint: null, active: false } },
      'POST /api/settings/gateway/test': { body: { ok: true, models: ['m1', 'm2'] } },
      'POST /api/settings/gateway': { body: { ...saved, baseUrl: 'http://localhost:11434', hasKey: false, defaultModel: 'm2' } },
    });
    render(<GatewaySettingsForm active />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ollama' }));
    expect(screen.getByLabelText(/URL/)).toHaveValue('http://localhost:11434');

    fireEvent.click(screen.getByRole('button', { name: /테스트|Test/ }));
    expect(await screen.findByTestId('gateway-test-result')).toHaveTextContent('2');
    fireEvent.change(screen.getByLabelText(/기본 모델|Default model/), { target: { value: 'm2' } });

    fireEvent.click(screen.getByRole('button', { name: /^(저장|Save)$/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/settings/gateway'))).toBe(true));
    const saveCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/settings/gateway'));
    expect(saveCall?.body).toEqual({ baseUrl: 'http://localhost:11434', defaultModel: 'm2', writeModels: true });
  });

  it('explains that remote devices cannot change the gateway', async () => {
    stubFetch({ 'GET /api/settings/gateway': { status: 403, body: { error: 'Forbidden' } } });
    render(<GatewaySettingsForm active />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
