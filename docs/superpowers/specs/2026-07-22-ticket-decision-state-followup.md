# 티켓 의사결정 상태 + 후속 대화 + 누적 집계

작성일: 2026-07-22 · 브랜치: `feat/ticket-centric-restructure`

## 문제

에이전트가 목표를 완수하지 못하고 사람에게 결정을 물으면(예: "a/b/c 중 택일"),
현재는 검증 미통과 → **실패**로 분류된다. 이는 실패가 아니라 사람 입력을 기다리는
상태다. 또한 그 상태에서 후속 프롬프트로 대화를 이어가며 결과를 도출할 수단이 없다.

## 목표

1. **의사결정** 상태를 신설해 5개 표시 상태로 관리: 진행중 · 의사결정 · 완료 · 종료 · 실패.
2. 의사결정 상태에서 후속 프롬프트를 이어 넣고(세션 resume) 결과를 재도출.
3. 대화 왕복 **누적 횟수 · 누적 토큰 · 누적 비용** 집계.

## 설계

### A. 상태 모델 (core)
- `TicketState`에 `decision` 추가: `queued|running|verifying|decision|done|failed`.
- 표시 상태(`DisplayStatus`): `active|decision|complete|closed|failed`.
- `decision`은 사람 입력 대기 → 동시실행 슬롯 **반납**(터미널 아님, resume 가능).
- 신규 `TicketTurn`: `{ role: 'agent'|'user', kind: 'result'|'decision'|'prompt', text, headline?, usage?, at }`.
- `Ticket`에 `turns: TicketTurn[]`, `rounds: number`(왕복 수), `usage`는 **누적치**.

### B. 감지 (DECISION: 마커)
- `ticketPrompt.ts`: "사람의 결정이 필요하면 HEADLINE 대신 `DECISION: <질문/선택지>`로 출력" 규약 추가.
- `extractDecision(result)`: `DECISION:` 파싱. runner `onMainDone`이 이를 먼저 확인 →
  있으면 검증 스킵, `decision` 상태로(질문을 turns에 기록), 슬롯 반납.

### C. 후속 대화 (server)
- `headlessClaude`: `buildHeadlessArgs`에 `resumeSessionId?` 추가 → `--resume <id>`.
- runner `reply(id, prompt)`: `decision` 상태에서만 허용. user turn 기록 →
  `running` → `claude -p <prompt> --resume <claudeSessionId>` → onMainDone 재사용
  (done/decision/failed 재분류). 매 run usage를 누적 합산, `rounds++`.
- `POST /api/tickets/:id/reply {prompt}` (loopback 전용, 기존 티켓 라우트와 동일 정책).
- WS: `decision` 상태·turns 변경 브로드캐스트(기존 broadcast 경로 재사용).

### D. UI
- `ticketDisplay`: `decision` 표시상태 + 색상(보라 `--accent-purple`, 폴백 `#d2a8ff`).
- `TicketsView`: 컬럼 5개(active·decision·complete·closed·failed).
- `TicketCard`: decision = 보라 액센트 + 질문 한 줄 + "답변하기" 힌트. 카드 클릭→모달.
- `TicketDetailModal`: **대화 스레드**(turns 렌더) + 하단 답변 입력창(decision일 때) +
  누적 지표(라운드 ↻n · 누적 토큰 · 누적 비용).
- `useTickets`: `replyTicket(id, prompt)`.

### E. i18n
- `tickets.columns.decision`, `tickets.decisionAnswer`(입력 placeholder),
  `tickets.send`, `tickets.rounds`, `tickets.threadUser`/`threadAgent` 등 EN/KO.

### F. 테스트
- `ticketRunner.test`: DECISION 감지→decision 상태·슬롯 반납, reply→resume→done,
  reply→다시 decision, usage 누적·rounds 증가.

## 비목표
- 실시간 스트리밍 표시(중간 tool 호출)는 기존처럼 불투명 유지.
- 코덱스/기타 어댑터의 DECISION 규약은 후속(본 스펙은 claude 헤드리스 경로).
