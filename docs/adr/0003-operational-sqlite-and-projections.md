# ADR-0003: 운영 상태는 append-only SQLite 이벤트 로그 + 재생성 가능한 projection

- 상태: **Accepted** (P0 storage prototype)
- 일자: 2026-07-20

## 맥락
라이브 상태가 메모리에만 있어 서버 재시작 시 소실된다. 나머지는 JSON 파일과 브라우저 localStorage에 흩어져 있어(→ Discovery inventory §3) 새로고침·다중 브라우저에서 목록이 달라진다.

## 결정
운영 상태의 단일 출처를 append-only SQLite 이벤트 로그로 둔다. 읽기 모델(projection)은 이벤트에서 **항상 재생성 가능**해야 하며 스스로 진실을 만들지 않는다. 드라이버는 Node 내장 `node:sqlite`를 쓴다(신규 네이티브 의존 없음). 파일 DB는 WAL.

## 근거
- `node:sqlite`: 저장소에 이미 `efficioReader`가 사용 중이며 검증됐다. `better-sqlite3`는 Node 버전 변경 시 로드 실패한다(실제 발생, `08fc84d`).
- append 순서(`id`)가 재생 순서다. `occurredAt`/`seq` 재정렬은 projection 계층 책임으로 둔다 — 로그는 "무엇이 언제 도착했는가"를 기록한다.

## 결과
- 구현: `packages/storage/` (`schema.ts`, `migrator.ts`, `eventStore.ts`, `dedupe.ts`), `core/canonical/projection.ts`
- dedupe는 native id 우선, 없으면 content-hash + `dedupeConfidence` 기록(§I.4). content-hash 경로는 원리적으로 best-effort이며 그 한계를 코드에 명시했다.
- **미결정:** 프로덕션 DB 파일 경로와 보존 정책(§K.1의 30일/크기 제한). P1 배선 시 확정한다.
