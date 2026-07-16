# 스프레드 뷰 상호작용·타일링 설계 / Spread View Interactive Tiling Design

- 작성일: 2026-07-16
- 대상: `packages/ui` (`views/chat`)
- 상태: 설계 확정(구현 착수)
- 선행 문서: `docs/plans/2026-07-15-jarvis-and-spread-views-design.md`

## 0. 범위

기존 스프레드 뷰(축소 미리보기 + 클릭 시 단일 뷰 승격)를 **상호작용 가능한 리사이즈 타일링 그리드**로 전환한다.

1. **인라인 입력** — 스프레드를 유지한 채 타일을 클릭하면 그 자리에서 포커스되어 키 입력이 해당 pty로 전달되고 출력이 그 자리에 스트리밍된다.
2. **레이아웃 조정** — 거터 드래그로 행·열 크기 조정, 타일 드래그로 위치 교환(swap). 조정 결과는 localStorage에 영속.
3. **단축키 + 호버 힌트** — 각 동작에 단축키를 부여하고, 타일 호버 시 단축키 힌트를 노출. 브라우저/터미널과 충돌하지 않도록 중앙 레지스트리에서 중복을 체크·관리.

**Non-goals:** 자유 캔버스 배치(겹침), 음성, 기존 단일/리스트/efficio 뷰 동작 변경.

## 1. 렌더링 모델 전환 (요청 ①)

- 기존 `fitSpreadScale`(CSS transform 축소)과 전체 `blur()`를 폐기한다.
- 스프레드 진입 시 각 타일의 xterm을 자기 셀 크기에 맞춰 **실제 `fit()`/`resize`** 한다(pty 리사이즈 → Claude TUI가 그 순간 리플로우; 합의된 트레이드오프).
- **포커스 타일** 상태 `focusedSpreadTabId` 도입. 타일 단일 클릭 → 강조 테두리(accent-blue) + `term.focus()`. 키 입력은 기존 `term.onData → onInput` 경로로 전달.
- 단일 뷰 승격은 클릭에서 분리: 타일 라벨의 **최대화 버튼(⤢)** 또는 **더블클릭** → 기존 `onSelectSpreadTile`.
- 리사이즈는 mousemove마다가 아니라 **드래그 종료(또는 ~100ms 스로틀)** 시에만 영향 타일을 재-fit.

## 2. 리사이즈 타일링 그리드 (요청 ②)

- 그리드는 `gridTemplateColumns`/`gridTemplateRows`를 **분수 배열**(`colFractions[]`, `rowFractions[]`)로 구동. template = `fractions.map(f => f+'fr').join(' ')`.
- wrapper(이미 `position:relative`)에 **오버레이 레이어**를 imperative 하게 얹어 거터 핸들을 절대배치. 열 경계 = 누적 분수 비율 × wrapper 폭, 행 경계 = × 높이.
- 거터 pointer 드래그 → 인접 두 분수를 delta 만큼 이동, 각 분수 최소값(`MIN_FRACTION`) 클램프. 드래그 종료 시 영향 타일 재-fit + 영속.
- 기본 그리드: `cols = ceil(√n)`, `rows = ceil(n/cols)`, 균등 분수.

## 3. 타일 이동(swap)

- 타일 라벨을 드래그 핸들로 사용(pointer 기반, HTML5 DnD 미사용 — xterm 간섭 회피).
- 다른 타일 위에서 pointerup → 두 슬롯의 `order` 인덱스 교환. 빈틈 없는 사각형 유지.

## 4. 영속 데이터 모델

신규 `spreadLayoutStore.ts` (localStorage 키 `claude-alive:spread-layout`):

```ts
interface SpreadLayout {
  cols: number;
  rows: number;
  colFractions: number[]; // length === cols
  rowFractions: number[]; // length === rows
  order: string[];        // 슬롯 순서의 tabId 배열
}
```

- `reconcileLayout(prev, tabIds)` 순수 함수:
  - 목표 그리드 = `defaultGrid(tabIds.length)`.
  - `prev`의 `cols/rows`가 목표와 같으면 분수 유지, 아니면 해당 축 균등 재설정.
  - `order` = `prev.order`에서 현존 tabId만 남기고, 신규 tabId를 뒤에 append, 닫힌 것 제거.
- 로드/저장은 `openTabsStore` 패턴을 따름(try/catch, 형태 검증, 실패 시 무해 폴백).

## 5. 단축키 + 호버 힌트 + 충돌 관리 (요청 ③)

### 5.1 중앙 레지스트리 (단일 출처)

신규 `spreadShortcuts.ts`:

```ts
interface SpreadShortcut {
  id: 'focus-left' | 'focus-right' | 'focus-up' | 'focus-down'
    | 'swap-left' | 'swap-right' | 'swap-up' | 'swap-down'
    | 'grow-width' | 'shrink-width' | 'grow-height' | 'shrink-height'
    | 'maximize' | 'reset-layout';
  alt: boolean; shift: boolean; ctrl: boolean; meta: boolean;
  key: string;       // KeyboardEvent.key (예: 'ArrowLeft', 'm', '0')
  labelKey: string;  // i18n
}
```

기본 배정(모두 **Alt(⌥) 기반** — Cmd/Ctrl 단독 조합은 브라우저/OS가 선점하므로 회피):

| 동작 | 조합 |
|---|---|
| 포커스 이동 | `Alt+←/→/↑/↓` |
| 타일 교환(swap) | `Alt+Shift+←/→/↑/↓` |
| 폭/높이 조정 | `Alt+Ctrl+←/→`(폭), `Alt+Ctrl+↑/↓`(높이) |
| 최대화(승격) | `Alt+M` |
| 레이아웃 초기화 | `Alt+0` |

### 5.2 충돌 관리 / 체크

- `assertUniqueShortcuts()` — 모듈 로드시 조합 중복을 검사, 중복이면 개발 중 throw. 런타임(prod)에서는 `console.error`로 강등.
- `matchShortcut(e)` — 레지스트리와 대조해 매치 반환.
- 핸들러는 **capture 단계**에서 wrapper(또는 spreadActive 동안 document)에 바인딩 → 매치 시 `preventDefault()` + `stopPropagation()`으로 xterm/브라우저 기본 동작을 모두 선점(겹침 방지). 스프레드가 아닐 때는 바인딩 해제 → 일반 터미널 사용 무간섭.

### 5.3 호버 힌트

- 각 타일에 힌트 오버레이(우상단 소형 배지 또는 라벨 옆)를 두고, `.spread-tile:hover` 시 CSS opacity로 노출.
- 힌트 텍스트는 레지스트리에서 `formatShortcut()`으로 생성(예: `⌥←`), 최대화 버튼 `title`에도 동일 소스 사용 → 표시와 동작이 항상 일치.

## 6. 구조 / 파일

신규(`packages/ui/src/views/chat/`):
- `spreadLayout.ts` — 그리드 수학(순수): `defaultGrid`, `makeEqualFractions`, `fractionsToTemplate`, `resizeAdjacent`, `slotToRC`/`rcToSlot`, `neighborSlot`.
- `spreadLayoutStore.ts` — 영속 + `reconcileLayout`(순수).
- `spreadShortcuts.ts` — 레지스트리 + `matchShortcut` + `assertUniqueShortcuts` + `formatShortcut`.

수정:
- `ChatOverlay.tsx` — 스프레드 이펙트를 위 모듈 기반으로 교체, `focusedSpreadTabId` 상태, 거터/힌트 오버레이 imperative 관리, 포커스·swap·resize 핸들러, capture-phase 단축키 핸들러.
- i18n `en/ko.json` — 라벨/힌트/툴팁 키.

## 7. 엣지 케이스

- 종료된 탭: 타일 표시(dim), 포커스 가능하나 입력 no-op(pty 없음).
- 스프레드 중 탭 추가/삭제: `reconcileLayout` 재조정 후 그리드·오버레이 재구성, 재-fit.
- 스프레드 이탈: 활성 탭 재-fit(기존 로직) — pty가 단일 뷰 크기로 복귀.
- localStorage 손상/비활성: 폴백으로 기본 그리드.

## 8. 테스트

- `spreadLayout.test.ts` — 기본 그리드/분수/template/거터 리사이즈 클램프/이웃 슬롯.
- `spreadLayoutStore.test.ts` — reconcile(분수 유지/재설정, order 병합·제거), 로드/저장 라운드트립.
- `spreadShortcuts.test.ts` — 조합 유일성, `matchShortcut` 매치/비매치, `formatShortcut`.
- 컴포넌트: 포커스 라우팅·거터 리사이즈·swap은 기존 `ChatOverlay.test.tsx` 범위에서 가능한 선까지 커버.
