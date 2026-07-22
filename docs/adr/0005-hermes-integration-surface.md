# ADR-0005: Hermes 통합은 TUI Gateway JSON-RPC를 1순위로 한다

- 상태: **Accepted** (P3 Spike 완료)
- 일자: 2026-07-20
- 검증 대상: Hermes Agent **v0.18.2** (로컬 설치본, `~/.hermes/hermes-agent`)

## 맥락

기획서 §H.3은 "1순위는 TUI Gateway JSON-RPC"라고 적었으나, 어떤 표면이 실제 존재하는지 확인되지 않아 ADR-0005는 Pending이었다. 로컬 조사에서 `hermes gateway`가 **메시징 게이트웨이(Telegram/Discord/WhatsApp)** 이고 에이전트 제어가 아니라는 사실이 드러나면서 전제 자체가 흔들렸다.

## Spike 결과 (실측)

세 후보가 모두 실재하며 성격이 다르다.

| 표면 | 실행 | 성격 | 실측 결과 |
|---|---|---|---|
| **TUI Gateway** | `tui_gateway/` 모듈 (CLI 최상위 명령 아님) | JSON-RPC, 에이전트 제어 전체 | **메서드 187개** |
| **ACP** | `hermes acp` | 에디터 통합 표준 (VS Code/Zed/JetBrains) | `hermes acp --check` → **OK** |
| **Backend server** | `hermes serve` (기본 포트 9119) | 데스크톱 앱·원격 클라이언트용 JSON-RPC/WebSocket | help 확인 |
| ~~`hermes gateway`~~ | — | **메시징 게이트웨이 — 에이전트 제어 아님** | 후보에서 제외 |

### TUI Gateway 메서드 카탈로그 (실측 발췌)

```
session.*  : create, list, active_list, activate, close, interrupt, history,
             compress, branch, title, usage, status, steer, resume, save,
             delete, undo, info, most_recent, context_breakdown
message.*  : start, delta, complete
tool.*     : start, started, generating, complete, output_risk
approval.* : request, respond
spawn_tree.*: list, load, save
```

```bash
grep -rhoE '"[a-z_]+\.[a-z_]+"' ~/.hermes/hermes-agent/tui_gateway/*.py | sort -u | wc -l   # → 187
```

### 이전 보고 정정

교차검증 보고서가 "`session.resume`은 존재하지 않으며 재개는 `session.activate`/`spawn_tree.load`로 처리된다"고 했으나 **이는 틀렸다.** 실제 소스에 `session.resume`이 존재한다. 기획서 §H.3의 원래 메서드 목록(`message.delta`, `tool.start/complete`, `approval.request`, `session.status/history/resume/branch`)은 **전부 실재한다.**

## 결정

1. **TUI Gateway JSON-RPC를 1순위 통합 표면으로 확정한다.** Alive가 필요로 하는 세션 수명주기·메시지 스트리밍·도구 수명주기·승인·서브에이전트(spawn tree)가 모두 이 표면에만 함께 존재한다.
2. **ACP는 fallback으로 둔다.** 표준이라 구현이 단순하지만 에디터 통합용이라 승인·spawn tree 등 표현 범위가 좁다. TUI Gateway 연동이 막히면 축소된 capability로 전환한다.
3. `hermes serve`는 원격 접속 시나리오(§P3.5)에서 재평가한다. 지금은 사용하지 않는다.
4. `hermes gateway`는 **에이전트 제어와 무관**하므로 문서·코드 어디에서도 통합 후보로 언급하지 않는다.

## 근거

- 187개 메서드 중 Alive가 §H.2 어댑터 계약을 채우는 데 필요한 것이 모두 TUI Gateway에 있다. ACP로는 `approval.*`·`spawn_tree.*`에 해당하는 표현을 확보할 수 없다.
- `hermes acp --check`가 OK를 반환하므로 fallback 경로의 가용성 자체는 검증됐다.

## 결과

- P3 착수 시 `tui_gateway` 진입점(stdio 또는 `ws.py`)의 기동 방식을 먼저 확정해야 한다. CLI 최상위 명령이 아니므로 Codex의 `codex app-server`처럼 단순 실행이 불가능하다 — 이것이 P3의 첫 리스크다.
- Codex에서 한 것처럼 **메서드 인벤토리를 fixture로 고정하고 드리프트 테스트**를 붙인다. Hermes는 스키마 생성기가 없으므로 소스 grep 기반 인벤토리를 쓴다.
- 미해결: TUI Gateway의 인증/세션 소유권 모델. P3 구현 전 확인 필요.
