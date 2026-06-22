# Efficio (M0 프로토타입)

Claude Code 세션의 **크기보정 낭비 신호**를 0 토큰(LLM 미사용)으로 산출하는 자기평가 도구.
`docs/waste-aware-eval-design.md`(v0.2.1)의 M0 범위 구현. **별도 제품**(claude-alive 확장 아님).

## 무엇을 재나

`~/.claude/projects`의 세션 transcript에서 결정론적 신호를 뽑아, **세션 크기에 회귀시킨
잔차**(크기가 아닌 낭비)를 자기 코퍼스 대비 백분위로 보여준다.

| 축 | 의미 | 검증 상태 |
|---|---|---|
| **W2 컨텍스트 재무효화** (주축) | 워밍업 제외 cache_creation 토큰의 크기보정 잔차 | ✓ H1 검증 (ρ≈0.5, n=30 파일럿) |
| W3 재탐색 | 동일 파일 반복 read | · 실험 (H1 약함) |
| WC 편집 반복 | 동일 파일 반복 edit | · 실험 (H1 약함) |

## 사용법

```bash
# 의존성: python3 + numpy (stdlib sqlite3)
python3 -m efficio collect              # 세션 스캔 → ~/.efficio/efficio.db (모델 없으면 초기 적합)
python3 -m efficio fit                  # 기준 모델 재적합(명시적 — 드리프트 통제)
python3 -m efficio timeline --last 20   # 주축(W2) 잔차 시계열 (백분위↑=낭비↑)
python3 -m efficio profile <session_id> # 한 세션 효율 프로파일 (id 접두어 가능)
python3 -m efficio --db /path/x.db ...  # DB 경로 override
```

### 재현성 — 기준 모델 고정 (드리프트 방지)

잔차/백분위는 **고정 기준 모델**(축별 Theil–Sen 계수 + 기준 잔차 분포)로만 채점한다.
세션을 더 모아도(`collect`) 같은 세션 점수는 **변하지 않는다**. 기준을 갱신하려면
`fit`을 명시적으로 호출(새 버전 저장, 옛 버전 보존 → 옛 점수 재현 가능). 이것이
"코퍼스가 늘면 점수가 바뀌는" 재현성 결함을 막는다.

## 설계·검증 근거

- **단일세션 WU:** PR↔세션 attribution이 결정론 불가(Pilot-0 오귀속률 55.7%)라 단일 세션 단위.
- **크기-잔차:** raw 신호는 크기 종속(PC1 78.8%). Theil–Sen 잔차화로 크기 분리(잔차 ρ≈0.1, 분산 66~79% 보존).
- **W2 우위:** H1 라운드2(n=30)에서 W2만 체감 기계적 낭비와 양의 상관 견고. W3/WC는 약해 실험축.
- 상세: `docs/waste-aware-eval-design.md` 13장, `docs/poc/`.

## 범위·한계

- 검증 범위는 **개발세션(turns≥3, assistant≥4)**. 1턴 리뷰 등은 신호가 비어 제외.
- H1은 **부분 성립**: 방향 확립·임계(ρ≥0.5) 미확정. 단일 사용자·자기 프로젝트 파일럿.
- **방향 타당성은 측정 안 함** — 잘못된 방향으로 잘 수행한 세션도 효율 높게 나올 수 있음(false positive).
- transcript JSONL은 30일 TTL·비공식 포맷 → 영속 저장으로 보완하되 파싱은 방어적.

## 프라이버시

`~/.efficio/efficio.db`에는 세션 제목·프로젝트 경로가 들어간다. **로컬 보관**하고 공유 금지.
저장소는 프롬프트 원문·코드를 저장하지 않는다(집계 신호만).
