# P0a Discovery Inventory — 현재 상태 (코드 검증)

> **이 문서가 현재 상태의 단일 출처입니다.**
> 대화 기록·과거 보고·이전 요약은 작성 시점의 스냅샷이며, 이 문서와 어긋나면 **무효(stale)** 로 취급합니다.
> 모든 항목에 재검증 명령이 붙어 있습니다. 인용하기 전에 명령을 실행해 확인하십시오.

- 검증 시점: 2026-07-20 (P1 진행 중 갱신)
- 검증 커밋: `08aba2f`
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
| 3 | `~/.claude-alive/alive.db` | `storage` | `node:sqlite` | 읽기/쓰기 | **운영 중** (P1 배선 완료, WAL) |

- (1)은 유일한 네이티브 의존입니다. Node 버전 불일치 시 로드 실패하며, `08fc84d`에서 서버를 죽이지 않고 degrade하도록 수정했습니다.
- (3)의 경로는 ADR-0003에 따라 `~/.claude-alive/alive.db`로 확정했습니다. `CLAUDE_ALIVE_EVENT_DB`로 override할 수 있습니다.
  스키마 v3까지 적용: `events`, `session_provider_refs`, `workspaces`.

```bash
ls ~/.think-prompt/*.db ~/.efficio/*.db
grep -rn "better-sqlite3\|node:sqlite" packages/*/src --include="*.ts" | grep -v __tests__ | sed 's|/src/.*||' | sort -u
```

### 그 외 파일 저장소 (`~/.claude-alive/`)

`managed-sessions.json`, `agent-names.json`, `project-names.json`, `server.pid`, `server.log`, `alive.db`(위 3번)

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

## 4. 배선 상태 (P1 진행 중)

| 산출물 | 프로덕션 호출 | 상태 |
|---|---|---|
| `runDoctor` (`cli doctor`) | 2 | ✅ 배선됨 |
| `ClaudeCanonicalStream` | 2 | ✅ **배선됨** — `onEvent` dual-write |
| `EventStore` / `SessionRefStore` / `WorkspaceStore` | 2 / 2 / 2 | ✅ **배선됨** — `~/.claude-alive/alive.db` |
| `probeWorkspace` | 2 | ✅ **배선됨** — workspace identity |
| `buildProjection` | 2 | ✅ **배선됨** — 부팅 시 로그에서 재생성 |
| `buildConversation` | 2 | ✅ **배선됨** — 대화 읽기 |
| `migrateLegacyState` | 0 | ❌ 미배선 (기존 상태 1회 이전, P1 잔여) |
| `runConformanceSuite` | 0 | ⚪ 설계상 테스트 전용 |

### v2 HTTP 엔드포인트 (동작 확인됨)

| 엔드포인트 | 상태 |
|---|---|
| `GET /api/v2/workspace-tree` | Location → Workspace → Session 트리 |
| `GET /api/v2/sessions/:id/conversation?cursor=` | 대화 항목, 미지 세션은 404 |

두 경로 모두 파이프라인 비활성 시 **503 + 사유**를 반환합니다(빈 결과로 위장하지 않음).

### 아직 UI에 노출되지 않음

v2 데이터는 서버에서 생성·저장·조회되지만 **UI는 여전히 v1 `AgentInfo`만 읽습니다.**
사용자가 화면에서 체감하는 변화는 아직 없습니다 (P1 잔여: UI projection 전환).

```bash
# 배선 여부 재확인 (테스트 제외 호출처 수)
grep -rn "\bEventStore\b" packages/*/src --include="*.ts" | grep -v __tests__ | grep -v "packages/storage/src"
```

**주의:** `ulid`·`runMigrations`를 단순 grep하면 `prompt-core`의 **별도 자체 구현**이 잡힙니다. canonical 쪽과 무관합니다 (→ 중복 구현, ADR-011 참조).

---

## 5. 검증 기준선

| 항목 | 값 |
|---|---|
| 전체 테스트 | **580 통과 / 45 파일 / 실패 0** |
| 빌드 | `turbo` 11 tasks 성공 |
| 서버 기동 | 확인 (hook 3건 end-to-end 반영 확인) |
| Degradation | 네이티브 모듈 손상 시 서버 생존·`/api/prompts` 503 확인 |
| v2 dual-write | 실서버 hook 5건 → canonical 이벤트 10건 영속, workspace/세션 매핑 확인 |
| v2 재시작 내성 | 3회 재시작에도 workspace 1개 유지(초기 결함 수정 후 실측) |

---

## 6. 환경 주의사항

- 셸에 `NODE_ENV=production`이 전역 설정되어 있습니다. `packages/ui/vitest.config.ts`가 이를 덮어쓰지만, 다른 도구에는 영향이 남습니다.
- `better-sqlite3`는 Node 버전 변경 시 재빌드가 필요합니다:
  `cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release`
