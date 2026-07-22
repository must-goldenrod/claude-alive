/**
 * File-backed evaluation persistence (spec 2026-07-22 §3).
 *
 * One record per finished ticket. Mirrors `ticketStore.ts`: dumb serialized-flush
 * persistence, immutable replace, capped. It never spawns or broadcasts — the
 * caller wires it to the runner and broadcasts. `guideFor` synthesises the
 * per-route guide on demand from the current records.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  seedAutoLabel,
  clampWeight,
  DEFAULT_EVAL_WEIGHT,
  type Ticket,
  type EvalLabel,
  type TicketEvaluation,
  type RouteGuide,
} from '@claude-alive/core';
import { synthesizeGuide } from './guideSynthesizer.js';

const DEFAULT_FILE = join(homedir(), '.claude-alive', 'evaluations.json');
const DEFAULT_MAX = 1000;

export interface EvalStoreOptions {
  filePath?: string;
  maxRecords?: number;
  now?: () => number;
}

export interface EvalLabelInput {
  label: EvalLabel;
  weight?: number;
  note?: string;
}

export interface EvalStore {
  load(): Promise<void>;
  list(): TicketEvaluation[];
  get(ticketId: string): TicketEvaluation | undefined;
  /** Create or refresh a record from a finished ticket. Preserves a human label. */
  upsertFromTicket(ticket: Ticket): Promise<TicketEvaluation>;
  /** Apply a human label/weight/note. Returns undefined if the id is unknown. */
  setLabel(ticketId: string, input: EvalLabelInput): Promise<TicketEvaluation | undefined>;
  /** Toggle the bias-reflection gate. Returns undefined if the id is unknown. */
  setReflected(ticketId: string, reflected: boolean): Promise<TicketEvaluation | undefined>;
  /** Synthesised guide for a route (cwd). Empty text when nothing is learned. */
  guideFor(route: string): RouteGuide;
}

export function createEvalStore(options: EvalStoreOptions = {}): EvalStore {
  const filePath = options.filePath ?? DEFAULT_FILE;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX;
  const now = options.now ?? Date.now;

  let records = new Map<string, TicketEvaluation>();
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
    let entries = [...records.values()];
    if (entries.length > maxRecords) {
      // Evict oldest by updatedAt first.
      entries = entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxRecords);
      records = new Map(entries.map((e) => [e.ticketId, e]));
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(entries, null, 2));
  }

  function evalsForRoute(route: string): TicketEvaluation[] {
    return [...records.values()].filter((e) => e.route === route);
  }

  return {
    async load() {
      try {
        const raw = await readFile(filePath, 'utf-8');
        const arr = JSON.parse(raw) as TicketEvaluation[];
        records = new Map(arr.map((e) => [e.ticketId, e]));
      } catch {
        records = new Map();
      }
    },

    list() {
      return [...records.values()];
    },

    get(ticketId) {
      return records.get(ticketId);
    },

    async upsertFromTicket(ticket) {
      const ts = now();
      const auto = seedAutoLabel(ticket);
      const existing = records.get(ticket.id);

      const captured = {
        ticketId: ticket.id,
        seq: ticket.seq,
        route: ticket.cwd,
        goal: ticket.goal,
        claudeSessionId: ticket.claudeSessionId,
        model: ticket.model,
        headline: ticket.headline,
        verdictPassed: ticket.verification?.passed,
        failureReason: ticket.failureReason,
        autoLabel: auto,
        // Durable snapshots so the ticket-management view can dissect a record
        // long after the source ticket is evicted from ticketStore.
        result: ticket.result,
        completedAt: ticket.endedAt,
      };

      const next: TicketEvaluation = existing
        ? {
            ...existing,
            ...captured,
            // A human label sticks; otherwise the effective label follows autoLabel.
            label: existing.humanLabeled ? existing.label : auto,
            // The bias-reflection gate is a human decision — never reset on re-upsert.
            reflected: existing.reflected,
            updatedAt: ts,
          }
        : {
            ...captured,
            label: auto,
            humanLabeled: false,
            reflected: false,
            weight: DEFAULT_EVAL_WEIGHT,
            createdAt: ts,
            updatedAt: ts,
          };

      records.set(ticket.id, next);
      await serializedFlush();
      return next;
    },

    async setLabel(ticketId, input) {
      const existing = records.get(ticketId);
      if (!existing) return undefined;
      const next: TicketEvaluation = {
        ...existing,
        label: input.label,
        humanLabeled: true,
        weight: input.weight === undefined ? existing.weight : clampWeight(input.weight),
        note: input.note ?? existing.note,
        updatedAt: now(),
      };
      records.set(ticketId, next);
      await serializedFlush();
      return next;
    },

    async setReflected(ticketId, reflected) {
      const existing = records.get(ticketId);
      if (!existing) return undefined;
      const next: TicketEvaluation = { ...existing, reflected, updatedAt: now() };
      records.set(ticketId, next);
      await serializedFlush();
      return next;
    },

    guideFor(route) {
      return synthesizeGuide(route, evalsForRoute(route), now());
    },
  };
}
