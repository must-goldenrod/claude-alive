# ADR-0011: prompt/efficio DB 소유권과 session ID link 계약

- 상태: **Accepted** (P0 package/data ownership review)
- 일자: 2026-07-20

## 맥락
저장소에 SQLite DB가 3개 있고 소유자와 접근 권한이 문서화되지 않았다(→ `docs/status/p0a-discovery-inventory.md` §2). canonical 이벤트 로그가 추가되면서 "어느 DB가 무엇의 출처인가"를 고정하지 않으면 중복 기록과 상충하는 집계가 발생한다.

## 결정

### 소유권 (단일 쓰기자 원칙)

| DB | 소유자 | Alive 서버의 접근 |
|---|---|---|
| `~/.think-prompt/prompts.db` | `prompt-core` | prompt 서브시스템만 읽기/쓰기. canonical 계층은 접근 금지 |
| `~/.efficio/efficio.db` | **외부 efficio (Python)** | **read-only.** Alive는 통계를 계산하지 않고 사전 채점된 행만 읽는다 |
| canonical event log (`storage`) | `@claude-alive/storage` | canonical 계층만 읽기/쓰기. prompt/efficio는 접근 금지 |

어떤 DB도 다른 DB의 테이블을 직접 읽지 않는다. 교차 참조는 아래 link 계약으로만 한다.

### session ID link 계약

세 DB는 서로 다른 세션 식별자를 쓴다. 조인 키는 **공급자 네이티브 세션 ID**로 고정한다.

- canonical: `SessionRecord.sessionId`(Alive ULID)가 내부 키, `providerSessionId`가 외부 조인 키
- prompt/efficio: Claude session ID를 그대로 사용
- 따라서 교차 조회는 항상 `providerSessionId` 경유. Alive ULID를 다른 DB에 기록하지 않는다.

canonical 측은 `session_provider_refs`로 `(provider, providerSessionId) → sessionId` 매핑을 보유한다. 이 테이블이 유일한 번역 지점이다.

### 실패 격리
prompt·efficio는 **선택적 서브시스템**이다. 로드/조회 실패는 명시적으로 로그를 남기고 기능만 비활성화하며, 대시보드를 중단시키지 않는다(`08fc84d`에서 구현·검증).

## 근거
- 단일 쓰기자 원칙이 없으면 같은 사실이 두 DB에 다른 값으로 존재할 수 있다.
- Alive ULID를 외부 DB에 퍼뜨리면 canonical 스키마 변경이 외부 도구를 깨뜨린다.

## 결과
- `session_provider_refs` 테이블은 아직 구현되지 않았다 → **P1 배선 시 필수**.
- 중복 구현 정리 대상: `prompt-core/src/ulid.ts`와 `core/canonical/ids.ts`가 병존한다. 소유 경계가 다르므로 즉시 통합하지 않되, 신규 코드는 canonical 쪽을 쓴다.
