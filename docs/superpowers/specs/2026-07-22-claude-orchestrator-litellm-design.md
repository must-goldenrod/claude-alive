# Claude 오케스트레이터 + litellm 위임 — 설계 (슬라이스 B)

- **날짜**: 2026-07-22
- **브랜치**: `feat/orchestrator-litellm` (base: origin/main `f50c721`)
- **방향**: B — Claude 오케스트레이터가 **도구로 서브에이전트에 위임** → 보고 수신 → 완료/실패/의사결정필요.

## 1. 목표 / 현재 토대

**목표 플로우**: 티켓 발행 → Claude 오케스트레이터 실행 → (필요 시) 서브에이전트(litellm 모델)에 서브태스크 위임 → 결과 종합 → 완료 / 실패 / **의사결정필요(사람에게 되물음)**.

**이미 있는 것 (main, #48 병합)**:
- `TicketState`에 `decision` + `decisionQuestion` + `TicketTurn`(대화) + `reply()`/resume 루프 + `SpawnMainOpts.resumeSessionId`.
- Executor seam(local/ssh) + `buildHeadlessArgs(--resume)`.

**추가할 것 (이 슬라이스)**:
1. litellm 위임 백엔드 클라이언트 + 연결 체크.
2. 오케스트레이터 Claude가 호출하는 **위임 도구** (`ca-delegate` CLI, agent PATH에 노출).
3. 오케스트레이터 프롬프트(위임 방법 + HEADLINE/DECISION 종료 규약).
4. 백엔드 레지스트리 + 온보딩 API/UI(연결 등록·체크).

## 2. 위임 메커니즘 — 도구 CLI (MCP 없이)

오케스트레이터 티켓은 `bypassPermissions`로 돌아 Bash를 쓸 수 있으므로, **위임을 CLI로 제공**한다(MCP 의존성 회피, 기존 headless claude 그대로 사용).

- `ca-delegate --model <id> [prompt]` — prompt는 인자 또는 stdin. litellm 게이트웨이에 chat completion 호출 → 서브에이전트 답변을 stdout로 출력. usage를 stderr에 JSON으로.
- headless claude 스폰 시 이 스크립트 디렉터리를 PATH 앞에 붙여 노출(`cleanEnv` 확장).
- 오케스트레이터 프롬프트가 "무거운/병렬화 가능한 서브태스크는 `ca-delegate`로 위임하라"고 지시.

**대안(후속)**: 동일 `delegate`를 MCP 도구로 승격(구조화). 슬라이스1은 CLI로 플로우를 먼저 세운다.

## 3. 데이터 모델 (core)

```ts
// tickets/orchestration.ts
export type BackendId = 'claude-local' | 'ssh' | 'litellm';
export interface BackendStatus { id: BackendId; label: string; kind: 'orchestrator'|'subagent'|'location';
  connected: boolean; detail?: string; models?: string[]; }
```
- `Ticket.orchestrated?: boolean` — true면 오케스트레이터 프롬프트 + 위임 도구 활성. (기본 false = 기존 단일 에이전트 동작, 무회귀)
- 위임 사용량은 티켓 usage(addUsage)에 합산(후속: turn별 기록).

## 4. server

- `orchestrator/litellmClient.ts` — `createLitellmClient({baseUrl, apiKey})`: `checkConnection(): {ok, models?, error?}`, `chat(model, messages): {content, usage}`. env `LITELLM_BASE_URL`(기본 https://litellm.must.codes) + `LITELLM_KEY`.
- `orchestrator/delegateCli.ts` — 빌드되어 `dist/orchestrator/delegateCli.js`; 래퍼 `ca-delegate`(shebang) 를 런타임 디렉터리에 생성해 PATH 노출.
- `orchestrator/backends.ts` — 레지스트리: claude-local(항상), ssh(프리셋 있으면), litellm(키 있으면). `list()`, `check(id)`.
- `ticketPrompt.ts` — `buildOrchestratorPrompt(goal, guide)`: 위임 규약 + `HEADLINE:`(완료)/`DECISION:`(의사결정필요) 종료 규약. `ticket.orchestrated`면 이걸, 아니면 기존 `buildMainPrompt`.
- 스폰 PATH에 delegate 디렉터리 주입(LocalExecutor 경유). SSH executor는 후속(원격 위임).
- HTTP: `GET /api/backends`(loopback), `POST /api/backends/:id/check`(loopback). 티켓 create body에 `orchestrated?: boolean`.

## 5. 오케스트레이터 프롬프트 규약

```
너는 오케스트레이터다. 목표를 달성하되, 무겁거나 병렬화 가능한 하위 작업은
서브에이전트에 위임할 수 있다:  ca-delegate --model gemini/gemini-2.5-flash-lite "하위작업 프롬프트"
(서브에이전트 답변을 stdout로 반환). 결과를 종합해 판단하라.
- 완료: 마지막 줄  HEADLINE: <한 줄 요약>
- 사람 결정 필요: 마지막 줄  DECISION: <질문>
```

## 6. UI (온보딩)

- **백엔드 연결 화면**(도구 그룹 신규 항목 또는 설정): 각 백엔드 카드 — 이름·종류·상태(connected/failed)·**"연결 확인"** 버튼(→ `/check`). litellm은 모델 수 표시.
- 티켓 생성 폼: "오케스트레이터로 실행" 토글(→ `orchestrated:true`).
- 의사결정필요(decision) 티켓 UI는 기존 것 재사용(질문 + reply).

## 7. 보안

- `/api/backends*` loopback 전용. LITELLM_KEY는 서버 env에서만(클라 노출 금지). delegate CLI는 서버 env 키 사용.
- 위임 프롬프트는 사용자 목표에서 파생 — litellm에 전송됨(외부 전송 고지).

## 8. 테스트 / 검증

- litellmClient: checkConnection/chat(모의 fetch 주입).
- delegateCli: 인자/스트림 파싱(모의).
- backends 레지스트리: 키 유무에 따른 목록/상태.
- 라이브: 오케스트레이터 티켓 1건 실제 실행 → ca-delegate로 litellm 위임 → 결과·decision 도출 확인.

## 9. 단계

1. O1: litellmClient + backends 레지스트리 + `/api/backends`·`/check` + 테스트. (연결·온보딩 백엔드)
2. O2: delegateCli + PATH 노출 + 오케스트레이터 프롬프트 + create `orchestrated` 배선.
3. O3: 온보딩 UI(백엔드 연결 화면) + 티켓 오케스트레이터 토글.
4. O4: 라이브 end-to-end(오케스트레이터 티켓이 litellm에 위임·종합·판단).

가역적: `orchestrated=false`(기본)면 전부 기존 동작.
