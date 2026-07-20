# Architecture Decision Records

기획서 `docs/plans/2026-07-16-multi-agent-alive-platform-atoz.md` §W의 ADR 목록을 개별 문서로 고정한 것입니다.

## 상태 정의

| 상태 | 의미 |
|---|---|
| `Proposed` | 구현 가설. 아직 증거 없음 |
| `Conditionally Accepted` | 제한된 Spike 증거가 있으나 exit gate가 남음 |
| `Accepted` | 구현과 테스트로 검증됨 |
| `Pending` | 결정에 필요한 증거를 아직 수집하지 못함 |

## 목록

| ADR | 주제 | 상태 | 확정 gate |
|---|---|---|---|
| [0001](0001-thin-orchestration.md) | thin orchestration/control plane | Accepted | P0 contract review |
| [0002](0002-canonical-event-and-raw-preservation.md) | canonical event + raw event 보존 | Accepted | P0 fixture review |
| [0003](0003-operational-sqlite-and-projections.md) | operational SQLite + rebuildable projection | Accepted | P0 storage prototype |
| [0004](0004-codex-app-server-transport.md) | Codex app-server stdio transport | **Accepted** | 0.144.6 스키마 실측 완료 |
| [0005](0005-hermes-integration-surface.md) | Hermes 통합 표면 | **Accepted** | P3 Spike 완료 (v0.18.2 실측) |
| [0006](0006-native-mcp-first.md) | native MCP 우선, 중앙 proxy opt-in | Accepted | P0 security review |
| [0007](0007-capability-driven-ui.md) | provider capability 기반 UI | Accepted | P0 adapter contract |
| [0008](0008-efficio-comparability.md) | Efficio 비교 조건/confidence | Proposed | M1 spec + P5 calibration |
| [0009](0009-local-single-user-security-boundary.md) | 로컬 단일 사용자 보안 경계 | Accepted | P0 threat model |
| [0010](0010-product-name-and-compat-migration.md) | 제품명과 호환 migration | Accepted | P0 말 branding 조사 완료 |
| [0011](0011-prompt-efficio-db-ownership.md) | prompt/efficio DB 소유권과 session ID link | Accepted | P0 package/data ownership review |
| 0012 | v1 compatibility projection/deprecation | Proposed | P0 golden fixture + P1 dual-run |

현재 상태의 사실 근거는 [`docs/status/p0a-discovery-inventory.md`](../status/p0a-discovery-inventory.md)를 참조하십시오.
