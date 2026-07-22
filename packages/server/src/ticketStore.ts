/**
 * File-backed ticket persistence (spec §아키텍처.1).
 *
 * Tickets survive a server restart. Mirrors the serialized-flush pattern of
 * `nameStore.ts` but keyed by ticket id and holding richer records. The store is
 * dumb persistence: it never spawns anything and never broadcasts — the runner
 * orchestrates and the caller broadcasts. Updates are immutable (a new object
 * replaces the old) so callers can hold a reference without it mutating.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Ticket, TicketCreateInput } from '@claude-alive/core';

const DEFAULT_FILE = join(homedir(), '.claude-alive', 'tickets.json');
const DEFAULT_MAX = 500;

export interface TicketStoreOptions {
  /** Persistence path. Injectable so tests use a temp file. */
  filePath?: string;
  /** Cap on retained tickets; oldest terminal (done/failed) tickets evicted first. */
  maxTickets?: number;
  now?: () => number;
  uuid?: () => string;
}

export interface TicketStore {
  load(): Promise<void>;
  list(): Ticket[];
  get(id: string): Ticket | undefined;
  create(input: TicketCreateInput): Promise<Ticket>;
  /** Returns the new (replaced) ticket, or undefined if the id is unknown. */
  update(id: string, patch: Partial<Ticket>): Promise<Ticket | undefined>;
  remove(id: string): Promise<boolean>;
}

export function createTicketStore(options: TicketStoreOptions = {}): TicketStore {
  const filePath = options.filePath ?? DEFAULT_FILE;
  const maxTickets = options.maxTickets ?? DEFAULT_MAX;
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? randomUUID;

  let tickets = new Map<string, Ticket>();
  let nextSeq = 1;
  let flushPromise: Promise<void> | null = null;

  async function serializedFlush(): Promise<void> {
    while (flushPromise) await flushPromise;
    flushPromise = flush();
    try {
      await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  async function flush(): Promise<void> {
    let entries = [...tickets.values()];
    if (entries.length > maxTickets) {
      // Keep all active tickets; evict the oldest terminal ones first.
      const active = entries.filter((t) => t.state !== 'done' && t.state !== 'failed');
      const terminal = entries
        .filter((t) => t.state === 'done' || t.state === 'failed')
        .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
      const keepTerminal = terminal.slice(0, Math.max(0, maxTickets - active.length));
      entries = [...active, ...keepTerminal];
      tickets = new Map(entries.map((t) => [t.id, t]));
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(entries, null, 2));
  }

  return {
    async load() {
      try {
        const raw = await readFile(filePath, 'utf-8');
        const arr = JSON.parse(raw) as Ticket[];
        // Backfill seq for tickets persisted before seq existed, oldest first.
        let maxSeq = 0;
        const ordered = [...arr].sort((a, b) => a.createdAt - b.createdAt);
        for (const t of ordered) {
          if (typeof t.seq !== 'number') t.seq = ++maxSeq;
          else maxSeq = Math.max(maxSeq, t.seq);
        }
        nextSeq = maxSeq + 1;
        tickets = new Map(arr.map((t) => [t.id, t]));
      } catch {
        tickets = new Map();
        nextSeq = 1;
      }
    },

    list() {
      return [...tickets.values()];
    },

    get(id) {
      return tickets.get(id);
    },

    async create(input) {
      const ticket: Ticket = {
        id: uuid(),
        seq: nextSeq++,
        goal: input.goal,
        cwd: input.cwd,
        ...(input.location ? { location: input.location } : {}),
        ...(input.orchestrated ? { orchestrated: true } : {}),
        state: 'queued',
        createdAt: now(),
      };
      tickets.set(ticket.id, ticket);
      await serializedFlush();
      return ticket;
    },

    async update(id, patch) {
      const existing = tickets.get(id);
      if (!existing) return undefined;
      const next: Ticket = { ...existing, ...patch, id: existing.id };
      tickets.set(id, next);
      await serializedFlush();
      return next;
    },

    async remove(id) {
      const existed = tickets.delete(id);
      if (existed) await serializedFlush();
      return existed;
    },
  };
}
