# ADR-0008: Efficio는 조건과 confidence 없이 공급자를 순위화하지 않는다

- 상태: **Proposed** (M1 spec + P5 calibration에서 확정)
- 일자: 2026-07-20

## 맥락
"토큰을 적게 썼다"는 효율이 아니다. 공급자마다 cache token 정의, 이벤트 신뢰도, 작업 난이도가 다르다. 보정 없이 순위표를 만들면 사용자를 오도한다.

## 결정
단일 종합 점수를 기본 노출로 삼지 않는다. Outcome evidence / Waste residual / Token efficiency / Interaction burden / Reliability 묶음을 보여준다. 종합 지표는 실험 지표로만 제공하며 scorer version·비교 집단·표본 수·confidence·누락 입력을 함께 표시한다.

비교는 다음 조건을 만족할 때만 허용한다: 같은 measurementSource 등급, 모델·작업 유형 보정 완료, 최소 표본 충족.

## 근거
- 구조화 이벤트와 PTY 추론 데이터를 같은 신뢰도로 섞으면 결론이 무의미해진다.
- 현재 Efficio의 M1 난이도/게이트와 타당도 검증 부채가 선행 과제다(`docs/efficio-status.md`).

## 결과
- Efficio 스키마에 `provider`, `providerVersion`, `model`, `taskType`, `workspaceId`, `runId`, `measurementSource`, `measurementConfidence`, `scorerVersion` 추가 필요.
- 미확정 사유: M1 게이트 스펙이 아직 없다. P5에서 확정한다.
