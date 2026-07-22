# ADR-0004: Codex는 app-server stdio JSON-RPC로 통합한다

- 상태: **Accepted** (codex-cli 0.144.6 실측 완료)
- 일자: 2026-07-20

## 맥락

Codex는 여러 transport를 제공한다. 어떤 것을 기본으로 삼을지, 그리고 프로토콜이 문서화된 대로인지 확인이 필요했다.

## Spike 결과 (codex-cli 0.144.6 실측)

```
codex app-server --listen <URL>
    Supported values: `stdio://` (default), `unix://`, `unix://PATH`, `ws://IP:PORT`, `off`
    [default: stdio://]
codex app-server --stdio
    Use stdio as the transport (equivalent to `--listen stdio://`)
```

- `codex app-server generate-json-schema --out DIR` → **스키마 파일 39개 생성 성공**
- `ServerNotification` **64개**, `ServerRequest` **9개** 메서드 확인

### 이전 보고 정정

교차검증 보고서가 "`--stdio` 플래그는 확인되지 않으며 stdio는 플래그 없는 기본 동작"이라고 했으나 **이는 틀렸다.** `--stdio`는 실재하는 별칭이다. 기획서의 로컬 Spike 주장이 정확했다.

## 결정

`codex app-server`를 **stdio 자식 프로세스**로 붙인다(기본값이므로 플래그 불필요, 명시가 필요하면 `--stdio`). 외부 포트를 열지 않아 §N.1 보안 경계와 일치한다.

버전별 프로토콜은 `generate-json-schema` 산출물을 근거로 삼고, 메서드 인벤토리를 fixture로 저장소에 고정한다.

## 근거

- stdio는 기본값이라 버전 호환에 가장 안전하고, ws/unix listener는 인증 표면을 추가한다(`--ws-auth`, `--ws-token-file`).
- 스키마 생성기가 있어 프로토콜 드리프트를 기계적으로 감지할 수 있다.

## 결과

- `packages/core/src/canonical/__fixtures__/codex/protocol-0.144.6.json` — 메서드 인벤토리
- `codexProtocolDrift.test.ts` — 매퍼가 다루는 method가 실제 스키마에 존재하는지 검사
- **미구현**: stdio 자식 프로세스 supervisor와 `initialize` handshake. 매핑·계약은 완료됐으나 프로세스 수명주기 관리는 남아 있다.
