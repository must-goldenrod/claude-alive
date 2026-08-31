import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchPicker } from '../BranchPicker.tsx';

const CLEAN = { current: 'main', branches: ['main', 'feat/x'], dirty: false };

/** Stubs fetch with a route table; every unmatched call fails the test loudly. */
function stubFetch(routes: { list?: unknown; result?: unknown }) {
  // `'list' in routes` rather than `??` below: a deliberate null (not a repo) is
  // a distinct case from "unspecified".
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      const payload = url.includes('/api/git/branches') && (init?.method ?? 'GET') === 'GET'
        ? { branches: 'list' in routes ? routes.list : CLEAN }
        : { result: routes.result ?? { ok: true, branch: 'feat/x' } };
      return { ok: true, json: async () => payload } as unknown as Response;
    }),
  );
  return calls;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe('BranchPicker', () => {
  it('renders nothing without a folder', () => {
    stubFetch({});
    const { container } = render(<BranchPicker cwd="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists local branches with the current one selected', async () => {
    stubFetch({});
    render(<BranchPicker cwd="/r/proj" />);
    const select = await screen.findByTestId('branch-select');
    expect(select).toHaveValue('main');
    expect(screen.getByRole('option', { name: 'feat/x' })).toBeInTheDocument();
  });

  it('checks out the branch chosen from the list', async () => {
    const calls = stubFetch({});
    render(<BranchPicker cwd="/r/proj" />);
    fireEvent.change(await screen.findByTestId('branch-select'), { target: { value: 'feat/x' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/git/checkout') && c.method === 'POST')).toBe(true),
    );
    expect(calls.find((c) => c.url.includes('/api/git/checkout'))?.body)
      .toEqual({ cwd: '/r/proj', name: 'feat/x' });
  });

  it('creates a branch from the one currently checked out', async () => {
    const calls = stubFetch({ result: { ok: true, branch: 'feat/new' } });
    render(<BranchPicker cwd="/r/proj" />);
    fireEvent.click(await screen.findByTestId('branch-new'));
    fireEvent.change(screen.getByTestId('branch-name'), { target: { value: 'feat/new' } });
    fireEvent.click(screen.getByTestId('branch-create-submit'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.body)).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ cwd: '/r/proj', name: 'feat/new', from: 'main' });
  });

  it('reports the server refusal instead of retrying', async () => {
    stubFetch({ result: { ok: false, code: 'dirty' } });
    render(<BranchPicker cwd="/r/proj" />);
    fireEvent.change(await screen.findByTestId('branch-select'), { target: { value: 'feat/x' } });
    expect(await screen.findByTestId('branch-error')).toBeInTheDocument();
  });

  it('names the offending branch in a no-such-branch refusal', async () => {
    stubFetch({ result: { ok: false, code: 'no-such-branch', name: 'ghost' } });
    render(<BranchPicker cwd="/r/proj" />);
    fireEvent.change(await screen.findByTestId('branch-select'), { target: { value: 'feat/x' } });
    expect(await screen.findByTestId('branch-error')).toHaveTextContent('ghost');
  });

  it('warns about uncommitted changes before you try to move', async () => {
    stubFetch({ list: { ...CLEAN, dirty: true } });
    render(<BranchPicker cwd="/r/proj" />);
    expect(await screen.findByTestId('branch-hint')).toBeInTheDocument();
  });

  it('says so, quietly, when the folder is not a repository', async () => {
    stubFetch({ list: null });
    render(<BranchPicker cwd="/tmp/plain" />);
    expect(await screen.findByTestId('branch-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-select')).not.toBeInTheDocument();
  });

  it('asks before deleting and passes the confirmed branch through', async () => {
    const calls = stubFetch({ result: { ok: true, branch: 'main' } });
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<BranchPicker cwd="/r/proj" />);
    fireEvent.click(await screen.findByTestId('branch-delete'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')?.body)
      .toEqual({ cwd: '/r/proj', name: 'feat/x' });
  });

  it('does not delete when the confirmation is declined', async () => {
    const calls = stubFetch({});
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<BranchPicker cwd="/r/proj" />);
    fireEvent.click(await screen.findByTestId('branch-delete'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('tells the caller which branch is now checked out', async () => {
    stubFetch({ result: { ok: true, branch: 'feat/x' } });
    const onChanged = vi.fn();
    render(<BranchPicker cwd="/r/proj" onChanged={onChanged} />);
    fireEvent.change(await screen.findByTestId('branch-select'), { target: { value: 'feat/x' } });
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('feat/x'));
  });
});
