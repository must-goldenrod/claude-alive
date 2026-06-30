/**
 * Efficio 자동 수집 트리거. 세션 종료(SessionEnd/SubagentStop) 시 호출되면
 * 디바운스 후 `python3 -m efficio collect`를 한 번 spawn한다. DB가 새로 써지면
 * 기존 efficio 디렉터리 watcher(index.ts)가 efficio:update를 브로드캐스트하므로
 * 여기서는 수집만 트리거하면 된다.
 *
 * 설계:
 * - efficioRoot가 null이면 전부 no-op(자동 수집 비활성 — efficio 소스를 못 찾았거나 토글 off).
 * - 디바운스로 연속 종료를 1회로 합친다.
 * - 동시 실행은 1개. 실행 중 들어온 schedule은 끝난 뒤 정확히 1회만 후속 실행(coalesce).
 * - 실패는 fail-open: 로그만 남기고 서버에 전파하지 않는다.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EfficioCollectorDeps {
  /** efficio 패키지(efficio/)의 부모 디렉터리. null이면 자동 수집 비활성. */
  efficioRoot: string | null;
  /** python 실행 파일명/경로(numpy 불필요 — stdlib만). */
  python: string;
  /** 마지막 schedule 이후 이 시간(ms)이 지나야 실제 collect 실행. */
  debounceMs: number;
  /** 실제 수집 실행기(테스트 주입용). 기본은 child_process spawn. */
  runCollect?: (root: string, python: string) => Promise<void>;
  /** 진단 로그(실패 등). 기본은 무음. */
  onLog?: (msg: string) => void;
}

export interface EfficioCollector {
  /** 세션 종료 시 호출. 디바운스 후 1회 collect. */
  schedule(): void;
  /** 대기 중 디바운스 취소(서버 종료 시). */
  stop(): void;
}

const COLLECT_TIMEOUT_MS = 120_000;

export function createEfficioCollector(deps: EfficioCollectorDeps): EfficioCollector {
  const { efficioRoot, python, debounceMs, onLog } = deps;
  const runCollect = deps.runCollect ?? defaultRunCollect;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;

  function fire(): void {
    timer = null;
    if (running) {
      pending = true; // 실행 중 — 끝난 뒤 한 번만 다시
      return;
    }
    running = true;
    runCollect(efficioRoot as string, python)
      .catch((e: unknown) => onLog?.(`[efficio] auto-collect failed: ${String(e)}`))
      .finally(() => {
        running = false;
        if (pending) {
          pending = false;
          fire();
        }
      });
  }

  return {
    schedule(): void {
      if (!efficioRoot) return; // 비활성
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
    },
    stop(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** 실제 수집: `python -m efficio collect`를 efficioRoot에서 실행. fail-open(에러도 정상 종료). */
function defaultRunCollect(root: string, python: string): Promise<void> {
  return new Promise<void>((resolveRun) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(python, ['-m', 'efficio', 'collect'], { cwd: root, stdio: 'ignore' });
    } catch {
      resolveRun(); // spawn 자체 실패(예: python 경로 오류) → 조용히 종료
      return;
    }
    const killer = setTimeout(() => child.kill('SIGKILL'), COLLECT_TIMEOUT_MS);
    const done = () => {
      clearTimeout(killer);
      resolveRun();
    };
    child.on('error', done); // python 미설치 등
    child.on('close', done);
  });
}

/**
 * efficio 패키지 루트(efficio/ 의 부모)를 해석. 우선순위: EFFICIO_DIR 환경변수 →
 * 번들(패키지 내) → repo(개발). 어디서도 못 찾으면 null(자동 수집 비활성).
 * numpy 제거로 efficio가 순수 stdlib라 패키지에 번들된 소스도 그대로 실행된다.
 */
export function resolveEfficioRoot(): string | null {
  const env = process.env.EFFICIO_DIR;
  if (env && hasEfficio(env)) return env;
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/efficioCollector.js 기준으로 위로 올라가며 efficio/ 를 찾는다.
  const candidates = [
    resolve(here, '..'), // 패키지 루트(번들 시 <pkg>/efficio)
    resolve(here, '../..'),
    resolve(here, '../../..'), // packages/server/dist → repo 루트
    resolve(here, '../../../..'),
  ];
  for (const c of candidates) {
    if (hasEfficio(c)) return c;
  }
  return null;
}

function hasEfficio(root: string): boolean {
  return existsSync(join(root, 'efficio', '__main__.py'));
}
