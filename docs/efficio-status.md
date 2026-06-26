# Efficio 개발 현황 추적 (Status & Backlog)

> 본 문서는 `docs/waste-aware-eval-design.md`(설계 v0.2.1)의 로드맵 대비 **현재 구현 상태와 남은 작업**을 한곳에 모은 추적용 인덱스다. 설계 근거·검증 수치는 설계 문서와 `docs/methodology-review.md`·`docs/round3-preregistration.md`를 참조한다.
>
> 갱신 기준일: 2026-06-26 / 기준 커밋: `4836023` (PR #33 머지)

---

## 0. 한눈에 보기

| 단계 | 상태 | 비고 |
|---|---|---|
| Pilot-0 | 부분 완료 | attribution 실측(오귀속 55.7%)·신호밀도 1차 측정 완료. 임계 확정·재현은 미완 |
| **M0 코어** | 구현 완료 | 단일세션 결정론, SQLite, profile/timeline. **제품(TS) 통합 완료** — scores export → server 읽기 브리지 → RightPanel EfficioPanel 시계열. 입력원 transcript 파싱 |
| **M0 제품 통합** | 완료 | DB 읽기 브리지(node:sqlite read-only, 의존성 0 추가). `/api/efficio/{status,timeline,profiles}` + WS efficio:update. **전용 Efficio 탭(다축 프로파일 카드·산점도·분포·다축시계열) 완료.** 실시간 WS 자동 새로고침만 백로그 |
| M1 | 미착수 | 게이트 명세 + 난이도 보정 + SLO 계측 |
| M2 | 미착수 | T2 LLM 판별 |
| M3 | 미착수 | 팀 집계 (k-익명성 기술강제 선결) |

| 검증 가설 | 상태 |
|---|---|
| H5 구성타당도 (축 ≠ 크기 대리지표) | 1차 완료 (PCA/EFA) |
| H1 기준타당도 (잔차 ↔ 헛수고) | 1차만 (W2 ρ=+0.57). **정식 검증 차단** (평정자·라벨 필요) |
| H1b 신호밀도 (≥30%) | 잠정 (Pilot-0 확정 전) |
| H1c 다방법 수렴 (MTMM) | 3방법 측정 완료 (체감/행동 분기 관측) |
| H2~H4 (난이도·게이트·T2) | 미착수 (M1·M2 의존) |

---

## 1. M0 도구 완성도 (코드로 닫을 수 있음 — 사용자 입력 불필요)

- [x] **M0-1 제품 통합** — **DB 읽기 브리지** 채택. efficio가 `collect`/`fit` 시 `scores` 테이블에 축별 점수 영속화(`profile.export_scores`) → server가 `node:sqlite` read-only로 읽어 `GET /api/efficio/{status,timeline}` + WS `efficio:update`(fs.watch) → UI `RightPanel`의 `EfficioPanel`. **server는 통계를 재계산하지 않음**(드리프트 단일출처=efficio Python). 의존성 0개 추가. End-to-end 검증: 실 DB 230세션·920점수행, 브라우저 렌더 확인.
- [ ] **M0-2 입력원 정합** — 문서 M0 스펙은 "OTel/훅 수집"이나 현재는 `~/.claude/projects` transcript 직접 파싱. `packages/hooks`(17 이벤트) 연계 여부 미설계. (통합과 무관하게 잔존)
- [x] **M0-3 UX** — (1) RightPanel `EfficioPanel`(축 선택 + 잔차 시계열 스파크라인 + `collect` 안내), (2) **HeaderBar 'Efficio' 전용 탭** `EfficioView`: 세션 리스트 + 4뷰(SessionDetailCard 4축 상세·크기vs잔차 산점도·다축 시계열·분포 히스토그램), `GET /api/efficio/profiles` 데이터원. End-to-end 브라우저 렌더 검증(231세션). **실시간 WS 자동 새로고침만 백로그.**
- [ ] **M0-4 추가 결정론 신호** (open Q #3) — W2/W3/WC/Bash 외 신규 신호 후보 탐색.

## 2. 검증 부채 (데이터·라벨 필요 — **사용자 차단**)

- [ ] **V-1 H1 정식 검증** — 라운드3 사전등록(`round3-preregistration.md`) 완료. 실행엔 **≥2 평정자 · n≈70 라벨 · ICC(2,1)/Krippendorff α · BCa 부트스트랩** 필요. → 평정자·라벨 입력 대기.
- [ ] **V-2 H1b 신호밀도 임계 확정** — ≥30% 잠정값을 Pilot-0 더 큰 표본으로 확정.
- [ ] **V-3 타 사용자 일반화** — 현재 단일 사용자 코퍼스. 외부 세션 데이터 필요.
- [ ] **V-4 체감/행동 2차원 축 확정** — EFA가 단일 공통인자 → 군집 라벨 provisional. 차원성은 신호 구조가 아니라 기준관계에 존재(라벨↔rework = −0.52).

## 3. 마일스톤 미착수 (M1~M3, 순서 엄격)

- [ ] **M1 게이트 + T1** — 게이트 알고리즘 완전 명세(설계 5.2: 플래그 조건·임계·AND/OR 결합·Tier 상승) → 난이도 보정(난이도 ≠ 크기) → 자기 토큰 SLO + `gate_suppression_rate` 계측·시간기반 자동 원복.
- [ ] **M2 T2 판별** — 반복 성격 LLM 분류, ambiguous 비율 실측, 사례 기반 피드백.
- [ ] **M3 팀 집계 + T3** — **k-익명성/차분프라이버시 기술강제 이후에만.** 캘리브레이션·드리프트 모니터.

## 4. 미해결 질문 (Open Questions, 설계 12장)

- [ ] **OQ-1 기준선 한계 명시** — 현재 기준선은 "크기 대비 예상"(잔차)이지 "이상적 최소 궤적"이 아님. 규칙/모델 기반 기준선은 시작시점 난이도 데이터 부재로 보류.
- [ ] **OQ-2 attribution 대안** — prepare-commit-msg 훅 세션ID 트레일러 주입의 현실성 / cwd+시간창 휴리스틱 오귀속률(병렬 환경).
- [ ] **OQ-4 멀티세션·멀티PR WU 경계 규칙.**
- [ ] **OQ-5 5분 설치** — OTel 없는 M0 최소 구성으로 재정의 가능한가.

---

## 5. 의존 순서 게이트

```
Pilot-0(부분) → M0(완료, 제품 통합 완료) → M1(게이트·난이도) → M2(T2) → M3(팀)
검증:  H5 ✅   |   H1 1차만(정식 차단)   |   H1b 잠정
```

- **M1 진입**은 게이트 명세(5.2)가 선결.
- **H1 정식 검증**은 평정자·라벨 없이는 진행 불가(차단).
- 제품 통합(§1 M0-1·M0-3)이 완료되어, **사용자 입력 없이 코드로 전진 가능한 다음 항목**은 §3 M1 게이트 명세 + 실시간 WS 자동 새로고침·efficio 테스트(백로그)다.

## 6. 산출물 인덱스

| 구분 | 경로 |
|---|---|
| M0 코어 | `efficio/` (signals·residual·reference·store·profile·cli, 테스트 5종, 34 passed) |
| 제품 통합 — 점수 export | `efficio/store.py`(scores 테이블·replace_scores), `efficio/profile.py`(export_scores), `efficio/cli.py`(_persist_scores) |
| 제품 통합 — server 브리지 | `packages/server/src/efficioReader.ts`(node:sqlite read-only), `httpRouter.ts`(`/api/efficio/*`), `index.ts`(fs.watch→WS) |
| 제품 통합 — core 타입 | `packages/core/src/efficio/types.ts`, `protocol/wsProtocol.ts`(efficio:update) |
| 제품 통합 — UI (RightPanel) | `packages/ui/src/views/dashboard/components/EfficioPanel.tsx`, `views/unified/RightPanel.tsx`, i18n en/ko `efficio.*` |
| 제품 통합 — 전용 뷰 | `packages/ui/src/views/efficio/` (EfficioView·SessionDetailCard·ScatterPlot·MultiAxisTimeline·DistributionHistogram·axes), HeaderBar 탭, server `efficioReader.profiles()` + `GET /api/efficio/profiles` |
| 외부 공유 요약 | `docs/efficio-paper-abstract.md` (초록급) |
| 설계 | `docs/waste-aware-eval-design.md` (v0.2.1) |
| 방법론 문헌대조 | `docs/methodology-review.md` |
| 라운드3 사전등록 | `docs/round3-preregistration.md` |
| 검증 POC | `docs/poc/*.py` (10종) |

> **프라이버시 주의:** `docs/poc/*.csv`·`*.db`는 비공개 세션 데이터를 포함하므로 `.gitignore`로 커밋 차단된다. 추가 검증 데이터 생성 시 동일 정책 유지.
