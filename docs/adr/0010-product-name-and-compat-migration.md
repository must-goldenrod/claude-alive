# ADR-0010: 제품명은 `claude-alive`를 유지하고, 개명은 별도 major로 분리한다

- 상태: **Accepted** (P0 말 branding/package 조사 완료)
- 일자: 2026-07-20

## 맥락

제품이 Claude 전용에서 멀티 에이전트(Claude/Codex/Hermes) 플랫폼으로 확장된다. `claude-alive`라는 이름은 Claude 전용을 함의하므로 장기적으로 부정확해진다. 동시에 이 이름은 이미 사용자와 npm 설치 경로에 가치가 축적돼 있다.

## 조사 결과 (2026-07-20, npm registry 실측)

| 이름 | 상태 |
|---|---|
| `claude-alive` | **TAKEN — 본 프로젝트 소유** (maintainer `hoyoungyang0526`, latest `0.5.9`) |
| `agent-alive` | 사용 가능 |
| `alive-workspace` | 사용 가능 |
| `aliveworkspace` | 사용 가능 |
| `agentalive` | 사용 가능 |

```bash
curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/<name>   # 404 = 사용 가능
```

내부 scope `@claude-alive/*`는 모두 `private: true`로 미배포이므로 개명 시 외부 영향이 없다.

## 결정

1. **CLI 이름과 npm 패키지명은 `claude-alive`를 유지한다.** 기능 추가와 개명을 동시에 하면 설치·업데이트 실패의 원인을 분리할 수 없다.
2. **제품 표기명은 "Alive Workspace"를 UI 내부에서 가칭으로 사용한다.** 코드·배포 식별자와 분리한다.
3. 개명은 P4 이후 제품이 안정화된 뒤 **별도 major 릴리스**로 수행한다. 그 시점에:
   - 새 CLI를 추가하고 기존 `claude-alive`는 동일 binary alias로 **2개 minor release 유지**
   - `CLAUDE_ALIVE_*` 환경변수를 계속 읽되, 새 변수가 있으면 우선
   - `@claude-alive/*` 내부 scope 변경은 private이므로 언제든 가능하나, 같은 major에서 한 번에 수행
4. **후보명은 `agent-alive`를 1순위로 예약 대상으로 둔다** — provider 중립적이고 기존 이름과의 연속성이 가장 크다.

## 근거

- 이름은 이미 소유하고 있어 잃을 위험이 없다. 서두를 이유가 없다.
- §V가 요구한 "초기 기술 작업은 브랜딩 변경에 의존하지 않아야 한다"를 만족한다.
- 개명 시 생태계 파손(설치/업데이트 실패)이 기획서 §U의 식별된 리스크이며, alias 2단계가 그 완화책이다.

## 결과

- P0~P3 동안 어떤 코드도 개명에 의존하지 않는다.
- 개명 실행 시점에 이 ADR을 supersede하는 ADR을 새로 작성한다.
- 미결: `agent-alive` 사전 예약(placeholder 배포) 여부는 개명 결정 시점에 판단한다.
