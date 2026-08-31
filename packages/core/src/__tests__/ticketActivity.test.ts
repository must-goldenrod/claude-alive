import { describe, expect, it } from 'vitest';
import type { Ticket } from '../tickets/types.js';
import { ticketLastActivityAt } from '../tickets/activity.js';

function ticket(over: Partial<Ticket> = {}): Ticket {
  return { id: 't', seq: 1, goal: 'g', cwd: '/p', state: 'running', createdAt: 1000, ...over } as Ticket;
}

describe('ticketLastActivityAt', () => {
  it('falls back to createdAt when nothing else happened', () => {
    expect(ticketLastActivityAt(ticket())).toBe(1000);
  });

  it('prefers startedAt over createdAt', () => {
    expect(ticketLastActivityAt(ticket({ startedAt: 2000 }))).toBe(2000);
  });

  it('uses the newest turn — the last thing said is the last thing that happened', () => {
    const t = ticket({
      startedAt: 2000,
      turns: [
        { role: 'agent', kind: 'decision', text: 'A or B?', at: 3000 },
        { role: 'user', kind: 'prompt', text: 'A', at: 5000 },
      ],
    });
    expect(ticketLastActivityAt(t)).toBe(5000);
  });

  it('uses endedAt when it is newer than the last turn', () => {
    const t = ticket({
      startedAt: 2000,
      endedAt: 9000,
      turns: [{ role: 'agent', kind: 'result', text: 'done', at: 5000 }],
    });
    expect(ticketLastActivityAt(t)).toBe(9000);
  });

  it('never regresses below createdAt on out-of-order timestamps', () => {
    expect(ticketLastActivityAt(ticket({ createdAt: 8000, startedAt: 1000 }))).toBe(8000);
  });
});
