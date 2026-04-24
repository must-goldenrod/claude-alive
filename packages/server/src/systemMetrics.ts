import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export interface SystemMetricsSnapshot {
  /** CPU usage across all cores, 0..1 (average since last poll). */
  cpu: number;
  /** Used memory in bytes. */
  memUsed: number;
  /** Total memory in bytes. */
  memTotal: number;
  /** Poll timestamp (ms since epoch). */
  timestamp: number;
}

interface CpuTimeSample {
  idle: number;
  total: number;
}

function sampleCpuTimes(): CpuTimeSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/**
 * Compute "available" memory in a way that matches what users see in platform task managers.
 *
 * Why not just `os.freemem()`:
 * - macOS: `os.freemem()` = truly unused pages only. It excludes inactive, speculative, and
 *   purgeable pages which the OS can reclaim instantly. On a typical Mac with heavy app use
 *   this reports < 500 MB free even when Activity Monitor shows 4+ GB available, producing
 *   a misleading 95-100% usage indicator.
 * - Linux: `os.freemem()` = `MemFree` from /proc/meminfo, which excludes buffers/cache. Also
 *   underreports. The correct value is `MemAvailable`, which the kernel computes specifically
 *   for this purpose (accounts for reclaimable cache).
 * - Windows: `os.freemem()` is close enough to what Task Manager reports.
 *
 * Fallback: if platform-specific parsing fails, use `os.freemem()`.
 */
function getAvailableMemoryBytes(memTotal: number): number {
  if (process.platform === 'darwin') {
    try {
      const stdout = execFileSync('vm_stat', [], { timeout: 800, encoding: 'utf8' });
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1]!, 10) : 16384;
      const parsePages = (key: string): number => {
        const m = stdout.match(new RegExp(`${key}:\\s+(\\d+)\\.`));
        return m ? parseInt(m[1]!, 10) : 0;
      };
      // Available = immediately reclaimable pages: free + inactive + speculative + purgeable.
      // This roughly matches Activity Monitor's "Memory Pressure" heuristic for available memory.
      const pagesFree = parsePages('Pages free');
      const pagesInactive = parsePages('Pages inactive');
      const pagesSpeculative = parsePages('Pages speculative');
      const pagesPurgeable = parsePages('Pages purgeable');
      return (pagesFree + pagesInactive + pagesSpeculative + pagesPurgeable) * pageSize;
    } catch {
      // fall through to os.freemem()
    }
  } else if (process.platform === 'linux') {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const m = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (m) return parseInt(m[1]!, 10) * 1024;
    } catch {
      // fall through
    }
  }
  // Windows + fallback: os.freemem() is a reasonable approximation.
  const free = os.freemem();
  // Clamp to [0, memTotal] defensively.
  return Math.max(0, Math.min(memTotal, free));
}

/**
 * Polls CPU and memory usage at a fixed interval.
 *
 * CPU: diffs cumulative counters from `os.cpus()`; reports 0..1 average across cores.
 * Memory: uses platform-aware "available" calculation (see getAvailableMemoryBytes).
 */
export class SystemMetricsPoller {
  private intervalMs: number;
  private handle: ReturnType<typeof setInterval> | null = null;
  private lastSample: CpuTimeSample = sampleCpuTimes();
  private lastMetrics: SystemMetricsSnapshot | null = null;
  private listeners = new Set<(snapshot: SystemMetricsSnapshot) => void>();

  constructor(intervalMs = 2000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.handle) return;
    this.handle = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  latest(): SystemMetricsSnapshot | null {
    return this.lastMetrics;
  }

  subscribe(listener: (snapshot: SystemMetricsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private tick(): void {
    const sample = sampleCpuTimes();
    const idleDelta = sample.idle - this.lastSample.idle;
    const totalDelta = sample.total - this.lastSample.total;
    this.lastSample = sample;

    const cpu = totalDelta > 0 ? 1 - idleDelta / totalDelta : 0;
    const memTotal = os.totalmem();
    const memAvailable = getAvailableMemoryBytes(memTotal);
    const memUsed = Math.max(0, memTotal - memAvailable);

    const snapshot: SystemMetricsSnapshot = {
      cpu: Math.max(0, Math.min(1, cpu)),
      memUsed,
      memTotal,
      timestamp: Date.now(),
    };
    this.lastMetrics = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
