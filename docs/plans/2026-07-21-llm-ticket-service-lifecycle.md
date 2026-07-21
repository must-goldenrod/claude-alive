# LLM 티켓 서비스 생애주기 — 개발 계획 문서

> **문서 위치.** 본 문서는 `docs/waste-aware-eval-design.md`(설계 v0.2.1)의 로드맵 중
> **M1(게이트 + T1)** 진입과, 그 뒤에 이어지는 **결과·종료 추적 → 의사결정 피드백 루프**를
> 하나의 "티켓(작업 단위) 생애주기"로 정형화하는 실행 계획이다. 현재 상태(무엇이 이미 됐고
> 무엇이 안 됐는지)는 `docs/efficio-status.md`(갱신 2026-06-26, 기준 커밋 `4836023`)를
> 단일 출처로 삼는다. 설계 근거·검증 임계는 설계 문서와 `docs/methodology-review.md`를 참조한다.
>
> 작성일: 2026-07-21 · 대상 브랜치: `claude/llm-ticket-service-lifecycle-mhex87`
> · 상태: **초안(설계 승인 대기)**

---

## 0. 한 줄 요약

Claude Code 세션 하나하나를 **"티켓(작업 단위, Work Unit)"** 으로 보고 —
접수 → LLM 처리 → 결과 산출 → **결과·종료 추적** → **판정(게이트)** → **개선 후보 피드백** —
의 전 과정을 하나의 **관측 가능한 생애주기**로 정형화한다. 그 위에서, 축적된 티켓 결과를
근거로 다음 작업의 **문서 품질·완성도 조정 제안**을 만드는 의사결정 지원 층을 얹는다.

세 가지를 먼저 못 박는다.

1. **claude-alive/efficio는 LLM 실행을 "통제"하지 않고 "관측·기록·피드백"한다.** 티켓의
   LLM 처리 단계는 Claude Code 자체가 수행하며, 본 서비스는 그 전후의 수집·채점·피드백을
   담당한다. 생애주기의 "처리" 상태는 우리가 만드는 것이 아니라 관측하는 것이다.
2. **"편향(bias)"은 자동 강제가 아니라 제안 가중치다.** 축적된 결과로 다음 작업의 문서
   품질을 조정하려는 신호는 **CLAUDE.md 규칙 후보/리뷰 제안** 형태로만 노출되며, 사용자
   승인 없이 산출물을 바꾸지 않는다. 방향 타당성 미측정(§7) 면책을 모든 제안에 부착한다.
3. **본 계획은 새 검증 부채를 만들지 않는다.** M1은 코드로 닫을 수 있는 범위(게이트 명세·
   구현·계측)에 한정하고, 라벨·평정자가 필요한 정식 검증(H1 등)은 기존 차단 상태(§7)를
   그대로 승계한다.

---

## 1. 배경 — 현재 상태 (근거: `docs/efficio-status.md`)

| 단계 | 상태 | 요지 |
|---|---|---|
| Pilot-0 | 부분 완료 | attribution 오귀속 55.7% 실측, 신호밀도 1차 측정. 임계 확정 미완 |
| **M0 코어** | **완료** | 단일세션 결정론 신호(W2/WC/Bash/W3), SQLite 영속, `profile`/`timeline` CLI |
| **M0 제품 통합** | **완료** | DB 읽기 브리지(`node:sqlite` read-only) → `/api/efficio/{status,timeline,profiles}` + WS `efficio:update`. RightPanel `EfficioPanel` + 전용 `EfficioView` 탭 |
| **M1 게이트 + T1** | **미착수** | 본 문서의 1차 대상. 설계 5.2 명세가 선결 |
| M2 T2 판별 / M3 팀 집계 | 미착수 | M1 이후 |

**이미 있는 것 = 티켓 생애주기의 절반.** 현재 파이프라인은 사실상 티켓의 **접수→기록→
채점→(수동)프로파일 조회**까지를 구현한다. 다만:

- 티켓의 **결과/종료 상태**(성공·중단·에러·미완)를 명시적으로 추적하지 않는다. `work_units`는
  신호·토큰·크기만 저장할 뿐, "이 티켓이 어떻게 끝났나"의 종료 상태 필드가 없다.
- 채점 결과를 **다음 작업으로 되먹이는 판정(게이트)·피드백 층**이 없다. `EfficioRepeat`
  (`topBash`/`topEdits`)이 "개선 후보"를 이미 산출하지만(코드 주석: "CLAUDE.md 규칙 후보로
  직접 쓰인다"), 이를 생애주기 안에서 순환시키는 구조가 없다.
- 입력원은 여전히 `~/.claude/projects` transcript 직접 파싱이다(M0-2 미완: `packages/hooks`
  17 이벤트 연계 미설계). 종료 상태 추적은 이 훅 연계와 맞닿는다.

**본 계획의 빈칸 = 생애주기의 나머지 절반**: (A) 결과·종료 추적, (B) 게이트 판정, (C) 개선
후보 피드백 루프, (D) 이 셋의 제품 통합.

---

## 2. 개념 — 티켓 생애주기 (Ticket Lifecycle)

### 2.1 용어 매핑

| 본 문서 용어 | efficio/코어 대응 | 비고 |
|---|---|---|
| **티켓(Ticket)** | Work Unit(WU) = 단일 세션 | 설계 2.1 단계1 정의. PR 단위(단계2)는 attribution 오귀속률 ≤10% 확정 전까지 보류 |
| 접수(Ingested) | transcript 존재 감지 | `parser.ts` / `claudeSessionIndex.ts` |
| 처리(Processing) | 세션 진행 중(LLM 실행) | Claude Code가 수행. `AgentState`(active/waiting 등)로 관측 |
| 결과(Resulted) | 세션 종료 + 신호 추출 | `signals.py` → `work_units` 저장 |
| **종료 추적(Outcome)** | **(신규)** 종료 상태 분류 | 본 계획 Phase 1 |
| 판정(Adjudicated) | 게이트 플래그 + Tier 결정 | **(신규)** 본 계획 Phase 2, 설계 5.2 |
| 피드백(Fed-back) | 개선 후보 → 규칙/리뷰 제안 | **(신규)** 본 계획 Phase 3. `EfficioRepeat` 확장 |

> **주의 — 티켓 ≠ 이슈트래커 티켓.** 여기서 "티켓"은 지라식 이슈가 아니라 "하나의 완결된
> 작업 세션"을 가리키는 내부 추상이다. 외부 이슈트래커 연동은 본 계획 범위 밖이다.

### 2.2 생애주기 상태 전이

```
[접수] ──감지──▶ [처리] ──세션종료──▶ [결과산출] ──collect──▶ [기록·채점]
                                                                   │
                          ┌────────────────────────────────────────┘
                          ▼
                     [종료추적] ──분류──▶ [판정(게이트)] ──플래그──▶ [피드백]
                       done/error/                T0~T3            개선후보 →
                       aborted/partial            Tier 결정         규칙·리뷰 제안
```

- **[처리]→[결과산출]** 경계는 세션 마지막 assistant 메시지 + TTL(30일) 안에서만 유효. 실시간
  종료 감지는 `packages/hooks`의 `SessionEnd`/`Stop` 이벤트로 보강 가능(§4 Phase 1 선택지).
- **[판정]은 [기록·채점] + [종료추적]을 모두 입력으로 받는다.** 게이트는 신호(잔차)만이 아니라
  "이 티켓이 어떻게 끝났나"를 함께 본다 → 낭비 신호 높음 + 정상 종료 = 판정 유보, 낭비 신호
  높음 + 에러 종료 = 개선 후보 승격, 등.
- **[피드백]은 되먹임이되 자동 강제가 아니다.** 산출물은 "제안"이며 사용자가 채택할 때만
  다음 티켓의 [처리]에 영향(CLAUDE.md 규칙 등)을 준다.

### 2.3 종료 상태(Outcome) 분류 — 결정론 우선

| 종료 상태 | 결정론 판별 신호 | Tier |
|---|---|---|
| `done` (정상) | 마지막 assistant 메시지가 도구 없이 종료, 에러 이벤트 없음 | T0 |
| `error` | transcript에 오류/`is_error` 도구 응답이 종단에 위치 | T0 |
| `aborted` | 세션이 진행 중 상태로 TTL 경과(마지막 이벤트 후 무활동) | T0 |
| `partial` | 미해결 TODO/도구 실패가 남은 채 종료 | T0 힌트 + 모호 시 T2 |
| `unknown` | 위로 분류 불가(신호 부족) | 명시적 "측정 불가" 라벨 |

> 종료 분류는 **결정론 1차 + 모호분류(ambiguous) 정식 카테고리**를 따른다(설계 2.3 원칙 승계).
> `partial`/`unknown`은 "0 = 데이터 없음"과 "정상 완료"를 혼동하지 않도록 데이터품질 플래그를 단다.

---

## 3. 아키텍처 — 기존 코드에 얹기

### 3.1 레이어 매핑

```
Claude Code Hook (17 이벤트) ─┐
~/.claude/projects transcript ─┼─▶ efficio(Python)              ─▶ ~/.efficio/efficio.db
                               │    signals→residual→reference       (work_units·scores
                               │    + [신규] outcome 분류             + [신규] outcomes·gates)
                               │    + [신규] gate 판정
                               ▼
                       server (읽기 브리지, node:sqlite read-only)
                       efficioReader.ts ──▶ /api/efficio/*  +  WS efficio:update
                               │           + [신규] /api/efficio/gates·outcomes
                               ▼
                       UI (React)  EfficioView / EfficioPanel
                               + [신규] 종료상태·게이트·개선후보 표시
```

**불변 원칙(설계 승계):** server는 통계를 **재계산하지 않는다.** 드리프트 단일 출처는
efficio(Python). 게이트 판정·종료 분류도 efficio 쪽에서 산출·영속화하고, server는 read-only로
읽어 노출만 한다. 신규 API도 이 규칙을 지킨다.

### 3.2 재현성 게이트(기존 규칙 승계)

- 잔차/백분위는 **고정 기준 모델**로만 채점한다. `collect`로 세션을 더 모아도 기존 티켓 점수는
  불변, 기준 갱신은 `fit` 명시 호출.
- **신규 게이트·종료 분류도 동일 원칙:** 게이트 플래그는 채점 시점의 기준 모델 버전에 고정
  되고, 종료 상태는 결정론이라 재현 가능. 게이트 임계 변경은 명시적 버전 증가로만.

---

## 4. 단계별 개발 계획

> 순서는 엄격하다. **Phase 1(종료추적) → Phase 2(게이트) → Phase 3(피드백) → Phase 4(제품통합).**
> Phase 2는 설계 5.2 게이트 명세가 **선결**이며, 명세 없이 Tier 발동률을 약속하지 않는다(설계 [F5]).

### Phase 1 — 결과·종료 추적 (LLM 0%, 결정론)

**목표:** 모든 티켓에 종료 상태(§2.3)를 결정론으로 부여하고 영속화.

- **P1-1** `efficio/signals.py`에 `classify_outcome(session)` 추가 — transcript 종단 구조로
  `done/error/aborted/partial/unknown` 분류. 순수 결정론, LLM 미사용.
- **P1-2** `efficio/store.py` 스키마 확장 — `work_units`에 `outcome TEXT`, `outcome_conf REAL`,
  `outcome_signals TEXT`(json) 컬럼 추가. **마이그레이션은 additive-only**(기존 행은
  `outcome=NULL` → 재-collect 시 채움). 기존 read-only 브리지 호환 유지.
- **P1-3** (선택) `packages/hooks` `SessionEnd`/`Stop` 이벤트로 실시간 종료 감지 연계 —
  M0-2(입력원 정합) 미결과 겹치므로, **본 Phase에서는 transcript 사후 분류를 정본으로 하고
  훅 연계는 후속**으로 분리(범위 확장 방지).
- **P1-4** `EfficioSessionProfile`(core 타입)에 `outcome` 필드 추가 + `efficioReader.ts`가
  읽어 노출. `/api/efficio/profiles` 응답에 종료 상태 포함.

**수용 기준:** 실 DB(≥230세션)에서 종료 분류 커버리지 측정, `unknown` 비율 로그. `unknown`이
과반이면 분류 규칙 재검토(공백 라벨 출시 방지, 설계 [F1] 정신 승계). 테스트: `test_signals.py`에
종료 분류 케이스 추가.

### Phase 2 — 게이트 판정 (M1 핵심, 설계 5.2)

**선결(코드 아님, 명세):** 설계 5.2가 요구하는 4종을 문서로 완전 명세한 뒤 착수.
(a) 플래그 조건 목록, (b) 각 조건 임계값, (c) 복수 조건 AND/OR 결합, (d) Tier 상승 결정 로직.
→ 본 계획 §5에 게이트 명세 스켈레톤을 두고, 착수 전 채운다.

- **P2-1** `efficio/gate.py`(신규) — 게이트 알고리즘 구현. 입력: 티켓의 잔차 신호 + 종료 상태
  + 크기 메타. 출력: `flags[]`, `tier(T0~T3)`, `suppressed(bool)`.
- **P2-2** 자기 토큰 SLO 계측 — `eval_cost_ratio`와 **`gate_suppression_rate`**(설계 5.5 ★신규)를
  함께 산출·영속화. **Silent degradation 차단**(설계 [F6]): 자동 보수화는 **시간기반 자동
  원복(24h)**을 반드시 동반, `gate_suppression_rate`를 노출.
- **P2-3** `store.py`에 `gates` 테이블 추가(session_id, model_version, flags, tier, suppressed,
  eval_cost_ratio, scored_at). 재현성 위해 model_version에 고정.
- **P2-4** 난이도 보정(설계 3.3) — 난이도 ≠ 크기. 프록시 계수(spec_len 등)로 회귀 잔차 방식.
  **본 Phase는 프록시(T0/T1 경량)까지만**, LLM 난이도 판별은 M2로 미룸.

**수용 기준:** 게이트 명세(§5) 100% 채워짐 + `gate.py` 단위 테스트(플래그·결합·Tier). SLO
계측이 `eval_cost_ratio median ≤1%, p95 ≤2%` 목표를 low/mid/high 발동률 시나리오로 검증
(설계 5.5 민감도). **본 Phase는 LLM Tier(T2)를 발동하지 않으므로 실제 토큰비용은 0에 수렴** —
계측 골격과 시나리오 분석이 산출물이다.

### Phase 3 — 개선 후보 피드백 루프 (편향 → 문서 품질·완성도 제안)

**목표:** 축적된 티켓 결과(신호 + 종료 + 게이트)를 근거로, 다음 작업의 문서 품질·완성도를
높이는 **제안**을 생성. "편향"은 제안 가중치이지 자동 강제가 아니다(§0-2).

- **P3-1** `EfficioRepeat` 확장 활용 — 이미 산출되는 `topBash`/`topEdits`(반복 개선 후보)에
  **종료 상태·게이트 가중치**를 결합해 우선순위화. 예: `error`로 끝난 티켓에서 반복된 Bash =
  높은 우선순위 개선 후보.
- **P3-2** `efficio/feedback.py`(신규) — 개선 후보 집계 → **CLAUDE.md 규칙 후보** / **리뷰
  체크리스트 항목** 텍스트 생성(결정론 템플릿, 토큰 0. 설계 5.3 "자연어는 템플릿으로 조립").
- **P3-3** 의사결정 지원 편향의 **정직 라벨** — 각 제안에 (근거 티켓 수, 신뢰도, **방향
  타당성 미측정 면책**)을 부착. "잘못된 방향으로 정확히 일한 세션도 높은 효율을 받을 수
  있음"(설계 [C5] false positive)을 제안 UI에 명시.
- **P3-4** `/api/efficio/feedback` 엔드포인트 + WS 반영 — server는 efficio가 산출한 제안을
  read-only로 노출만.

**수용 기준:** 제안이 **결정론 근거로 역추적 가능**(어느 티켓·어느 반복에서 나왔는지)해야
채택. 면책 라벨 누락 제안은 노출 금지. 자동으로 CLAUDE.md를 수정하지 않음(제안까지만).

### Phase 4 — 제품 통합 (UI 노출 + 실시간)

- **P4-1** `EfficioView`/`SessionDetailCard`에 종료 상태 배지 + 게이트 Tier 표시.
- **P4-2** 개선 후보 피드백 패널(제안 + 근거 + 면책 라벨). i18n: `packages/i18n` en/ko
  `efficio.*` 키 추가(하드코딩 문자열 금지, CLAUDE.md 규칙).
- **P4-3** **신규 페이로드의 실시간 반영** — 실시간 WS 자동 새로고침 배관(`fs.watch`→`efficio:update`
  →`EfficioView` 자동 refetch)은 **이미 구현되어 있다**(`packages/server/src/index.ts` fs.watch,
  `packages/ui/src/views/efficio/EfficioView.tsx` `efficio:update` 구독). 본 항목은 새 배관을 만드는
  것이 아니라, Phase 1~3이 추가하는 **종료·게이트·피드백 페이로드**를 기존 `efficio:update` 경로에
  실어 보내고 UI가 갱신하도록 연결하는 작업이다.

**수용 기준:** end-to-end 브라우저 렌더 검증(실 DB). `pnpm --filter=@claude-alive/ui exec tsc
--noEmit` 타입 통과. i18n 키 en/ko 동시 존재.

---

## 5. 게이트 명세 스켈레톤 (Phase 2 선결 — 착수 전 채운다)

> 설계 5.2가 요구하는 4종. **여기가 비어 있으면 Phase 2에 진입하지 않는다.**

- **(a) 플래그 조건 목록:** `high_residual`(잔차 백분위 ≥ θ₁), `zero_signal`(is_zero, 신호
  없음), `error_outcome`(종료=error), `partial_outcome`, `size_outlier`(크기 상·하위 꼬리),
  `repeat_present`(EfficioRepeat 존재) … _(착수 전 확정)_
- **(b) 임계값:** θ₁ 등 잠정치는 **Pilot-0/실 DB 실측으로 확정**(가정 금지, 설계 정신).
- **(c) AND/OR 결합:** 예) `error_outcome AND repeat_present → T2 승격`, `zero_signal →
  판정 유보(T0 고정)` … _(확정)_
- **(d) Tier 상승 로직:** T0(전량) → T1(난이도 보정) → T2(LLM 판별, **M2에서만 실발동**) →
  T3(표본 감사). 본 계획은 **T0/T1까지 실동작**, T2는 골격만.

---

## 6. 데이터·인터페이스 변경 요약

| 계층 | 변경 | 종류 |
|---|---|---|
| efficio store | `work_units.outcome*` 컬럼, `gates` 테이블 | additive 마이그레이션 |
| efficio 코드 | `signals.classify_outcome`, `gate.py`, `feedback.py` | 신규 |
| core 타입 | `EfficioSessionProfile.outcome`, 게이트/피드백 타입 | 추가(비파괴) |
| server | `efficioReader` 확장, `/api/efficio/{gates,outcomes,feedback}` | 읽기 전용 |
| protocol | `efficio:update`에 신규 데이터 포함(스키마 버전업) | 하위호환 |
| UI | 종료 배지·게이트·피드백 패널, 실시간 새로고침 | 추가 |
| i18n | `efficio.*` 신규 키(en/ko) | 필수 |

**호환성 원칙:** 모든 DB 변경은 additive-only(기존 read-only 브리지가 새 컬럼을 몰라도 동작).
core 타입은 옵셔널 필드로 추가해 기존 UI 비파괴.

---

## 7. 검증·수용 기준 (검증 부채 신규 생성 금지)

- **코드로 닫는 것(본 계획 대상):** 종료 분류 결정론 정확도(케이스 테스트), 게이트 명세
  완전성, SLO 계측 골격, 피드백 근거 역추적성, 제품 통합 타입·i18n·렌더.
- **승계하는 차단(사용자 입력 필요, 본 계획이 풀지 않음):**
  - V-1 H1 정식 검증(≥2 평정자·n≈70 라벨·ICC/α·BCa) — `round3-preregistration.md`. **차단 유지.**
  - V-3 타 사용자 일반화(단일 사용자 코퍼스) — 유지.
- **면책 명시 의무(설계 [C5]):** 본 서비스는 **실행 효율만** 측정하고 **방향 타당성은 측정
  하지 않는다.** 잘못된 방향으로 정확히 일한 티켓도 높은 효율/양호 종료로 보일 수 있다
  (false positive). 피드백 제안·게이트 판정·문서 품질 조정 제안 **전부에 이 면책을 부착**한다.
- **비목표 재확인(설계 1.2):** 개인 간 순위·인사고과·감시 도구 아님. 팀 집계는 M3 별도
  모듈 + k-익명성 기술강제 이후에만. 본 계획은 전 범위 **셀프 전용**.

---

## 8. 리스크 & 미해결 질문

| # | 리스크 | 대응 |
|---|---|---|
| R1 | 종료 분류가 비공식 JSONL 포맷에 취약(30일 TTL) | 방어적 파싱 + `unknown` 정식 라벨, 커버리지 로그 |
| R2 | 게이트가 조용히 측정 품질 저하(silent degradation) | `gate_suppression_rate` 노출 + 24h 자동 원복(설계 [F6]) |
| R3 | "편향" 피드백이 강제로 오인 | 제안까지만·사용자 채택 필수·면책 라벨(§0-2, §7) |
| R4 | 범위 확장(훅 연계·PR 단위 attribution) | Phase 1 훅 연계는 후속 분리, PR 단위는 오귀속률 ≤10% 확정 전 보류 |
| R5 | server 재계산 유혹(드리프트 이중출처) | 신규 API도 read-only 고정, 산출은 efficio 단일출처 |

**미해결 질문(설계 12장 승계):** OQ-1 기준선이 "이상적 최소 궤적"이 아님(잔차일 뿐),
OQ-2 attribution 대안, OQ-4 멀티세션 WU 경계, OQ-5 5분 설치. 본 계획은 이들을 **풀지 않고
명시적으로 유지**한다.

---

## 9. 의존 순서 게이트 & 마일스톤 매핑

```
M0(완료) ─▶ Phase1 종료추적 ─▶ Phase2 게이트(=M1) ─▶ Phase3 피드백 ─▶ Phase4 제품통합
             (LLM 0%)          (5.2 명세 선결)        (편향=제안)      (실시간 WS)
검증:  H5 ✅ · H1 1차만(정식 차단, 승계) · H1b 잠정
```

- **Phase 2 진입 = M1 진입.** 설계 5.2 게이트 명세(§5) 완성이 하드 게이트.
- **T2 LLM 판별·팀 집계는 본 계획 밖(M2/M3).** 본 계획은 M1과 그에 붙는 셀프 전용 피드백까지.

---

## 10. 구현 체크리스트

- [ ] P1-1 `classify_outcome` 결정론 분류
- [ ] P1-2 `work_units.outcome*` additive 마이그레이션
- [ ] P1-4 core 타입 + `efficioReader` 종료 노출
- [ ] §5 게이트 명세 4종 확정(Phase 2 선결)
- [ ] P2-1 `gate.py` 구현 + 테스트
- [ ] P2-2 SLO + `gate_suppression_rate` + 24h 자동 원복
- [ ] P2-3 `gates` 테이블(model_version 고정)
- [ ] P2-4 난이도 프록시 보정(T0/T1)
- [ ] P3-1~4 피드백 집계 + 면책 라벨 + `/api/efficio/feedback`
- [ ] P4-1~3 UI 배지·패널·실시간 + i18n en/ko
- [ ] end-to-end 렌더 + `tsc --noEmit` 통과

---

## 부록 A. 산출물 인덱스(예정 경로)

| 구분 | 경로 |
|---|---|
| 종료 분류 | `efficio/signals.py`(classify_outcome), `efficio/tests/test_signals.py` |
| 게이트 | `efficio/gate.py`, `efficio/store.py`(gates 테이블) |
| 피드백 | `efficio/feedback.py` |
| server 브리지 | `packages/server/src/efficioReader.ts`, `httpRouter.ts` |
| core 타입 | `packages/core/src/efficio/types.ts`, `protocol/wsProtocol.ts` |
| UI | `packages/ui/src/views/efficio/*`, i18n `efficio.*` |
| 근거 설계 | `docs/waste-aware-eval-design.md`(5.2·9장), `docs/efficio-status.md` |
