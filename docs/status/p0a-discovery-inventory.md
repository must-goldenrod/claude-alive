# P0a Discovery Inventory — 현재 상태 (코드 검증)

> **이 문서가 현재 상태의 단일 출처입니다.**
> 대화 기록·과거 보고·이전 요약은 작성 시점의 스냅샷이며, 이 문서와 어긋나면 **무효(stale)** 로 취급합니다.
> 모든 항목에 재검증 명령이 붙어 있습니다. 인용하기 전에 명령을 실행해 확인하십시오.

- 검증 시점: 2026-07-20
- 검증 커밋: `08fc84d`
- 대상 문서: `docs/plans/2026-07-16-multi-agent-alive-platform-atoz.md` (1,636줄)
- 재검증 일괄: `pnpm run build && pnpm exec vitest run`

---

## 0. 알려진 문서 드리프트

기획서 §P0a는 "현재 11개 package"라고 적지만 **실제는 12개**입니다. P0 CP3에서 `packages/storage`가 추가된 뒤 기획서가 갱신되지 않았습니다.

```bash
ls -d packages/*/ | wc -l    # → 12
```

---

## 1. 패키지 인벤토리 (12개)

| 패키지 | 역할 | 배포 |
|---|---|---|
| `cli` | `claude-alive` 실행 파일 (install/start/stop/status/autostart/logs/**doctor**) | npm bin |
| `core` | 공유 타입, SessionStore, AgentFSM, 프로토콜, **canonical 계약(P0 신규)** | 내부 |
| `hooks` | Claude Code 훅 등록 (17종 → HTTP POST) | 내부 |
| `i18n` | i18next 설정 + EN/KO 로케일 | 내부 |
| `server` | HTTP + WebSocket + PTY (port 3141) | 내부 |
| `storage` | **P0 신규.** SQLite append-only 이벤트 로그·dedupe·projection feed | 내부 |
| `ui` | React 프론트엔드 (Vite) | 정적 자산 |
| `prompt-core` | 프롬프트 분석 DB·큐 (better-sqlite3) | 내부 |
| `prompt-agent` | 프롬프트 서브시스템 (Fastify 라우트, 서버에 마운트) | 내부 |
| `prompt-worker` | 프롬프트 분석 큐 소비자 (서버 프로세스 내 실행) | 내부 |
| `prompt-rules` | 프롬프트 품질 규칙 | 내부 |
| `prompt-cli` | 프롬프트 CLI | 내부 |

```bash
ls -d packages/*/ | sed 's|packages/||;s|/||'
```

---

## 2. 데이터베이스 인벤토리 (3개)

| # | 경로 | 소유자 | 드라이버 | 접근 | 상태 |
|---|---|---|---|---|---|
| 1 | `~/.think-prompt/prompts.db` | `prompt-core` | **better-sqlite3** (네이티브) | 읽기/쓰기 | 운영 중 (WAL) |
| 2 | `~/.efficio/efficio.db` | **efficio (외부 Python)** | `node:sqlite` | **read-only** | 운영 중 |
| 3 | canonical event log | `storage` (P0 신규) | `node:sqlite` | 읽기/쓰기 | **경로 미정 · 프로덕션 미배선** |

- (1)은 유일한 네이티브 의존입니다. Node 버전 불일치 시 로드 실패하며, `08fc84d`에서 서버를 죽이지 않고 degrade하도록 수정했습니다.
- (3)의 파일 경로는 아직 결정되지 않았습니다 → **ADR-003 / P1 배선 시 확정 필요**.

```bash
ls ~/.think-prompt/*.db ~/.efficio/*.db
grep -rn "better-sqlite3\|node:sqlite" packages/*/src --include="*.ts" | grep -v __tests__ | sed 's|/src/.*||' | sort -u
```

### 그 외 파일 저장소 (`~/.claude-alive/`)

`managed-sessions.json`, `agent-names.json`, `project-names.json`, `server.pid`, `server.log`

---

## 3. 세션 상태 소스 (4곳 · 분산)

| # | 위치 | 내용 | 수명 |
|---|---|---|---|
| 1 | `SessionStore` (메모리, `core/src/state/sessionStore.ts`) | 라이브 에이전트 `AgentInfo` | **서버 재시작 시 소실** |
| 2 | `~/.claude-alive/managed-sessions.json` | UI가 spawn한 세션 + `claudeSessionId` (resume용) | 영구 (최대 200) |
| 3 | 브라우저 `localStorage['claude-alive:open-tabs']` | 열린 터미널 탭 | 브라우저별 (최대 50) |
| 4 | React state `sshSessions` (`ui/src/App.tsx:72`) | SSH 세션 | **탭 새로고침 시 소실** |

→ 같은 세션이 소스마다 다르게 표현되며 서버가 단일 출처를 갖지 않습니다. 이것이 §I.5 서버 소유 Catalog와 CP6 `migrateLegacyState`의 존재 이유입니다.

---

## 4. P0 산출물 배선 상태

| 산출물 | 프로덕션 호출 | 상태 |
|---|---|---|
| `runDoctor` (`cli doctor`) | 2 | ✅ **배선됨 — 유일한 사용자 체감 기능** |
| `ClaudeCanonicalStream`, `claudeHookToCanonical` | 0 | ❌ 미배선 |
| `EventStore`, `computeDedupeKey`, `runMigrations`(storage) | 0 | ❌ 미배선 |
| `buildProjection`, `normalizeLegacyState` | 0 | ❌ 미배선 |
| `migrateLegacyState`, `pickTitleSource` | 0 | ❌ 미배선 |
| `runConformanceSuite` | 0 | ⚪ 설계상 테스트 전용 |

```bash
# 배선 여부 재확인 (테스트 제외 호출처 수)
grep -rn "\bEventStore\b" packages/*/src --include="*.ts" | grep -v __tests__ | grep -v "packages/storage/src"
```

**주의:** `ulid`·`runMigrations`를 단순 grep하면 `prompt-core`의 **별도 자체 구현**이 잡힙니다. canonical 쪽과 무관합니다 (→ 중복 구현, ADR-011 참조).

---

## 5. 검증 기준선

| 항목 | 값 |
|---|---|
| 전체 테스트 | **486 통과 / 36 파일 / 실패 0** |
| 빌드 | `turbo` 11 tasks 성공 |
| 서버 기동 | 확인 (hook 3건 end-to-end 반영 확인) |
| Degradation | 네이티브 모듈 손상 시 서버 생존·`/api/prompts` 503 확인 |

---

## 6. 환경 주의사항

- 셸에 `NODE_ENV=production`이 전역 설정되어 있습니다. `packages/ui/vitest.config.ts`가 이를 덮어쓰지만, 다른 도구에는 영향이 남습니다.
- `better-sqlite3`는 Node 버전 변경 시 재빌드가 필요합니다:
  `cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release`
