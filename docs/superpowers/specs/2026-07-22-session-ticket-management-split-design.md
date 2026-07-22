# 세션 관리 / 티켓 관리 분리 + 편향 반영 게이트 (설계)

Date: 2026-07-22
Status: Approved — 구현 진행

## 배경 / 문제

`메뉴 > 도구 > 아카이브` 뷰는 이름과 달리 **완료된 세션(`CompletedSession`)** 을 보여준다
(`completed-sessions.json` → `GET /api/completed`). 즉 "세션이 어떻게 돌아갔는가"(duration,
tool call, token, last prompt)에 집중된 세션 중심 화면이다.

반면 **티켓**은 별개 모델(`Ticket`, goal 기반)이고, 티켓별 **평가/점수**(`TicketEvaluation`
— label good/bad, weight 1..5, note, autoLabel)는 `evaluations.json`에 누적된다. 이미 route별
`RouteGuide`를 합성해 다음 티켓 프롬프트에 prepend 하는 피드백 루프(=편향)도 존재한다.

요구: 아카이브를 **세션 관리**로 성격을 정리하고, 별도의 **티켓 관리** 데이터 공간을 신설한다.
티켓 단위로 처리 결과 + 점수를 계속 누적·해부하고, 그 결과를 **학습/편향(RouteGuide)에 반영할지
말지 사람이 결정**할 수 있어야 한다.

## 결정 사항

1. **메뉴**: 아카이브 라벨 → "세션 관리". tools 그룹에 "티켓 관리"(viewMode `ticketMgmt`) 신설.
2. **반영 게이트**: 명시적 opt-in. 기본 `reflected=false`(보류). 사람이 "편향에 반영"을 켜야만
   RouteGuide에 포함된다. (현행 자동 반영 동작이 바뀌는 지점)
3. **구성 축**: route(cwd) 그룹 중심 — RouteGuide 단위와 일치.
4. **해부 깊이**: 결과 + 점수 중심. 실제 실행 과정(이벤트/툴콜)은 `claudeSessionId`로 세션 관리
   뷰에 링크. 티켓 관리에 과정 임베드는 하지 않는다.
5. **영속성(접근 A)**: `TicketEvaluation`을 durable 티켓 기록으로 확장. `evaluations.json`이 곧
   티켓 관리의 데이터 공간이 된다. 새 store를 만들지 않는다.

## 데이터 모델 (core `tickets/evaluation.ts`)

`TicketEvaluation`에 4개 필드 추가:

- `result?: string` — 티켓 결과 markdown 스냅샷 (ticket 본체가 evict돼도 해부 가능하도록)
- `claudeSessionId?: string` — 세션 관리 링크 키 (이미 존재, upsert가 채우도록)
- `completedAt?: number` — 티켓 종료 시각
- `reflected: boolean` — 편향 반영 게이트. 기본 `false`.

`upsertFromTicket()`은 위 필드를 티켓에서 채우고, `reflected`는 `humanLabeled`처럼 **업서트 시 보존**한다.
기존 레코드(마이그레이션 전)는 `reflected` 없음 → falsy → RouteGuide에서 제외된다(의도된 동작).

## 편향 합성 (server `guideSynthesizer.ts`)

`synthesizeGuide()`가 route 평가 중 **`reflected === true`인 것만** 필터해서 good/bad 카운트와
가이드 텍스트를 만든다. 승인된 티켓만 다음 프롬프트에 주입된다. `goodCount`/`badCount`는 반영된
레코드 기준으로 센다.

## 저장소 (server `evalStore.ts`)

- `upsertFromTicket`: `result`, `claudeSessionId`, `completedAt` 캡처. `reflected` 보존(신규 생성 시 false).
- 신규 `setReflected(ticketId, reflected)`: 게이트 토글, `updatedAt` 갱신, flush.

## HTTP (server `httpRouter.ts`) — 모두 loopback 전용(기존 티켓 라우트와 동일)

- `GET /api/evaluations` (기존 재사용) — 티켓 기록 목록. 확장 필드 포함해 직렬화됨.
- `POST /api/tickets/:id/reflect` `{ reflected: boolean }` (신규) — 게이트 토글.
- `GET /api/tickets/guide?route=<cwd>` (신규) — route별 현재 RouteGuide 미리보기.

`options.tickets`에 `setReflected?`, `guideFor?` 추가. `index.ts`에서 evalStore로 배선.

## UI

- `viewGroups.ts`: `viewMode.archive` 라벨 텍스트 → "세션 관리". `ticketMgmt` 메타 추가(tools 그룹).
- `App.tsx`: `ViewMode`에 `'ticketMgmt'` 추가, lazy 뷰 + 렌더 슬롯.
- 신규 `views/ticketmgmt/`:
  - `TicketMgmtView.tsx` — 좌: route 그룹(누적 통계: total, good/bad, reflected 수) → 펼치면 티켓
    행. 우: 선택 티켓 해부.
  - `TicketDissection.tsx` — goal / model·effort·thinking / result markdown / verdict / 점수
    컨트롤(label·weight·note) / "편향에 반영" 토글 / "세션에서 과정 보기" 링크.
  - `RouteGuidePreview.tsx` — 선택 route의 현재 편향 텍스트 + good/bad 카운트.
- 크로스뷰 링크: "세션에서 과정 보기" → `claude-alive:navigate`(mode `archive`) + 대상 sessionId.
  세션 관리(ArchiveView)가 외부 지정 sessionId를 선택하도록 최소 지원 추가.
- i18n: `ticketMgmt.*` 키 en/ko 전부 추가. 하드코딩 금지.

## 데이터 흐름

```
티켓 완료 → upsertFromTicket (result·sessionId·completedAt 스냅샷, reflected 보존)
  → 티켓 관리 UI에 pending 노출
  → 사람: 해부 → label/weight/note → "편향에 반영" ON
  → POST /api/tickets/:id/reflect { reflected:true }
  → 다음 티켓 buildMainPrompt → guideFor(cwd)가 reflected만 합성 → 편향 주입
```

## 에러 처리

- `result` 없는 구 레코드 → "결과 스냅샷 없음" placeholder, 점수는 정상.
- reflect/evaluate 실패 → 낙관적 UI 롤백 + 에러 노출.
- reflected boolean·weight 1..5 클램프(기존) 검증.

## 테스트

- core: `TicketEvaluation` 확장 필드 타입.
- server: `synthesizeGuide`가 reflected만 반영, `setReflected` 토글·보존, upsert 신규 필드 캡처.
- ui: route 그룹핑, reflect 토글 낙관적 반영+롤백 (vitest, localStorage 스텁 주의).

## 릴리즈 노트

편향(RouteGuide) 반영이 자동 → 명시적 승인으로 바뀐다. 업그레이드 직후에는 과거 평가가 모두
보류 상태이므로, 사용자가 티켓 관리에서 "편향에 반영"을 켜기 전까지 프롬프트 주입 가이드가 비워진다.
