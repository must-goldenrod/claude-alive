# Efficio 검증 방법론 — 문헌 대조 리뷰

> Efficio(waste-aware-eval-design)에서 쓴 통계·측정 방법이 학술 표준에 부합하는지 4영역
> 병렬 문헌조사 + 우리 데이터 재확인. 작성: 검증 사이클 후속(자기점검 #3 연계).
> 상태별: ✅ 표준/타당 · ⚠️ 보정 필요 · 🔁 재프레이밍.

---

## 0. 한눈에 — 판정 요약

| 방법 | 판정 | 근거 문헌 |
|---|---|---|
| 비율 대신 **잔차**로 크기 정규화 | ✅ 옳음 | Kronmal 1993 (비율=spurious) |
| **Theil–Sen** 단일 confounder 회귀 | ✅ 타당 | Theil 1950, Sen 1968 |
| **부트스트랩 CI**(n작음·동점46%) | ✅ 적절 | Ornstein & Lyhagen 2016, Bishara & Hittner 2017 |
| size **over-control** 여부 | ✅ 우리 데이터상 아님(confounder) | Cinelli/Forney/Pearl 2022 + 우리 민감도 |
| **블라인드 라벨링**(점수 숨김) | ✅ 공통방법편향 통제 | Podsakoff 2003 |
| **프로파일(단일점수 금지)·고과 미연동** | ✅ 표준 정합 | SPACE(Forsgren 2021), Goodhart/Strathern 1997 |
| Spearman **검정력 공식** | ⚠️ Pearson용 → 보정 필요 | Bonett & Wright 2000 |
| **semipartial vs partial** | ⚠️ 한 변수만 잔차화(semipartial) | Cohen et al. AMR |
| **PCA → EFA/CFA** | ⚠️ 구성타당도 주장엔 EFA/CFA | Cronbach & Meehl 1955, AERA 2014 |
| **단일 평정자** | ⚠️ ICC/α + 약화보정 필요 | Spearman 1904, Koo & Li 2016 |
| ρ≥0.5 임계 사후설정 | ⚠️ SESOI 사전등록 + AIPE | Lakens 2018/2022, Maxwell et al. 2008 |
| 주관/객관 갈림(#4) | 🔁 MTMM '방법 분산' | Campbell & Fiske 1959 |

---

## 1. 표준으로 확인된 것 (✅)

- **잔차 정규화(비율 아님):** Kronmal(1993, *JRSS-A* 156:379)은 분자·분모가 성분을 공유하는 비율(y/size)이 허위 상관을 유발하므로 회귀에서 비율 사용을 피하고 잔차를 쓰라고 권고. 우리 선택과 일치.
- **Theil–Sen:** Theil(1950)·Sen(1968). 붕괴점 ~29%(OLS 0%), 비정규·이상치에 강건, 단일 예측변수의 표준 비모수 회귀. 우리처럼 confounder 1개엔 적합(다변량 확장 시 Huber/RANSAC 검토).
- **부트스트랩 CI:** 동점 46%·n<100·이산 분포에서 Fisher z 해석적 CI는 커버리지가 68%까지 하락(Bishara & Hittner 2017). 이산 지지 Spearman은 n<100에서 부트스트랩 우선(Ornstein & Lyhagen 2016). 우리가 부트스트랩(B=3000)을 쓴 건 옳음.
- **over-control 아님(우리 데이터 실증):** Cinelli/Forney/Pearl(2022, "A Crash Course in Good and Bad Controls")는 size가 *mediator*면 통제가 신호를 지움을 경고. 우리 데이터: 잔차화가 W2↔라벨을 **+0.28→+0.57로 강화**(Δ+0.29), 라벨↔size는 ρ=0.06. 잔차화가 신호를 *강화*했으므로 size는 confounder/suppressor이고 over-control이 아님. (단 이는 criterion 상관에 한정된 증거; DAG는 명시 권장.)
- **블라인드 라벨링:** 라벨링 시 신호 점수를 숨겨, Podsakoff et al.(2003)의 공통방법편향(동일 출처가 예측·준거를 함께 봄)을 절차적으로 통제. 잘한 부분.
- **프로파일·고과 미연동:** SPACE(Forsgren et al. 2021, *ACM Queue*)는 "생산성을 단일 지표로 환원 말 것·개인 평가에 쓰지 말 것"을 명시 → 우리 설계와 정합. Goodhart(1975)/Strathern(1997) "지표가 목표가 되면 지표이길 멈춘다"의 표준 대응이 '셀프·미연동'.

## 2. 보정이 필요한 것 (⚠️)

1. **Spearman 검정력 보정.** #3에서 쓴 `n=((Zα+Zβ)/atanh ρ)²+3`은 Pearson용. Spearman은 분산에 `(1+ρ²/2)` 곱이 붙음(Bonett & Wright 2000, *Psychometrika* 65:23). 영향은 **작음**(ρ=0.5: n 29→32, ρ=0.3: 85→89). 부트스트랩을 이미 써서 실무 영향은 작으나 #3 필요-n을 ~10% 상향.
2. **semipartial vs partial.** 우리는 신호(Y)만 size에 잔차화 → 엄밀히는 **semipartial(part) correlation**. 양변수 잔차화해야 partial(편상관)과 동치(Cohen, Cohen, West & Aiken). 쉬운 수정 — 라벨도 잔차화하거나 "semipartial"로 명시.
3. **PCA → EFA/CFA.** PCA는 오차분산을 분리 안 함 → PC1 78.8%가 척도 지배 artifact일 수 있음. 구성타당도 정식 주장엔 EFA(ML/PAF)→CFA(CFI≥.95)가 표준(Cronbach & Meehl 1955; AERA 2014). 현재 PCA는 탐색용으로만 표기.
4. **단일 평정자 → 약화보정.** 관측 ρ ≤ √(준거 신뢰도). 단일 평정자면 신뢰도 측정 불가 → 천장 미지. 라운드3에 **≥2 평정자 + ICC(2,1)/Krippendorff α**, 그 뒤 Spearman(1904) 약화보정(소표본 과교정 주의).
5. **SESOI 사전등록 + AIPE.** ρ≥0.5를 관측치 근처로 사후 설정한 건 약점(순환). 임계는 이론/실용 근거로 **사전등록**하고(예: ρ>0.3), 표본은 NHST 대신 **AIPE**(목표 CI 폭)로 산정(Maxwell, Kelley & Rausch 2008; Lakens 2018/2022). 등가/우월성 검정(TOST)로 "임계 초과"를 검정.

## 3. 재프레이밍 — 문헌이 준 더 나은 언어 (🔁)

- **#4 주관/객관 갈림 = MTMM '방법 분산'.** Campbell & Fiske(1959)의 다특성-다방법 행렬에서, 같은 구성(낭비)을 두 방법(주관 평정·객관 rework)으로 잰 상관이 낮음 = **수렴타당도 미확립**. 단 **2개 방법으로는 '방법 분산 vs 진짜 다차원'을 구조적으로 구분 불가**(최소 3방법 필요). → #4 결론을 "둘 중 하나(방법편향 또는 다차원 구성)이며 현 설계로 단정 불가"로 표기해야 정확.
- **METR(2025) 외적 코로보레이션.** 숙련 개발자가 AI로 **체감 20% 빠름 vs 실제 19% 느림(괴리 39%p)**(METR 2025, arXiv:2507.09089). 이는 우리 W2(체감)/WC(객관 rework) 갈림의 **거의 정확한 외부 재현** — 주관적 효율감과 객관적 행동이 AI 코딩에서 실제로 갈린다는 독립 증거. 우리 #4가 노이즈가 아닐 가능성을 지지.
- **rework 프록시의 리팩터링 교란.** Nagappan & Ball(2005, ICSE; 상대 churn이 결함 예측)과 후속(arXiv 2025: 리팩터링 오분류 시 F1 −37%p)은 "재편집=항상 낭비 아님(의도적 리팩터링)"을 경고 — 우리 #4b tautology 우려와 동일. → rework에 **리팩터링 필터**(간격 임계·커밋 패턴) 필요.
- **'회피 가능한 낭비' 계보.** Lean/TPS의 muda → 소프트웨어 매핑(Poppendieck 2003): 우리의 컨텍스트 재무효화=Relearning, 편집반복=Defects→Rework. 구성에 실제 계보 있음(단 지식작업 미시적용은 선례 없음).

## 4. 다음 작업에 반영할 액션 (라운드3 등)

1. SESOI **ρ>0.3 사전등록** + AIPE로 표본 산정(목표 CI 폭). ρ≥0.5 임계 폐기.
2. **≥2 평정자** + ICC/Krippendorff α 보고 + 약화보정. 블라인드 라벨링 유지.
3. **3번째 방법** 추가(예: 시간기반 낭비 탐지)로 MTMM '방법 vs 특성 분산' 분리 가능케.
4. rework 프록시에 **리팩터링 필터**.
5. 잔차화를 **양변수(partial)**로 + over-control **민감도 보고**(우리 데이터는 confounder 지지).
6. PCA는 탐색으로 표기, 구성 주장엔 EFA/CFA.
7. 검정력 필요-n에 **Bonett-Wright 보정**(~10% 상향).

---

## 참고문헌 (핵심)

**검정력·상관 표본:** Cohen 1988 *Statistical Power Analysis*; Bonett & Wright 2000 *Psychometrika* 65:23; Maxwell, Kelley & Rausch 2008 *Annu Rev Psychol* 59:537 (AIPE); Kelley & Maxwell 2003 *Psych Methods* 8:305; Lakens et al. 2018 *AMPS* 1:259 (TOST/SESOI); Lakens 2022 *Collabra* 8:33267; Bishara & Hittner 2017 *Behav Res Methods* 49:294; Ornstein & Lyhagen 2016 *PLoS ONE* 11:e0145595; Bujang 2024 *Restor Dent Endod* 49:e21.

**측정 타당도:** Cronbach & Meehl 1955 *Psych Bull* 52:281; Campbell & Fiske 1959 *Psych Bull* 56:81 (MTMM); Podsakoff et al. 2003 *J Appl Psychol* 88:879 (CMB); AERA/APA/NCME 2014 *Standards*; Spearman 1904 (약화보정); Koo & Li 2016 *J Chiropr Med* 15:155 (ICC); Austin & Villanova 1992 *J Appl Psychol* 77:836 (준거문제).

**교란·회귀:** Kronmal 1993 *JRSS-A* 156:379 (비율 spurious); Theil 1950; Sen 1968; Cinelli, Forney & Pearl 2022 *Soc Methods Res* 53:1071 (good/bad controls); Cohen, Cohen, West & Aiken *Applied Multiple Regression*.

**개발자 생산성·낭비:** Forsgren et al. 2021 *ACM Queue* 19:1 (SPACE); Forsgren, Humble & Kim 2018 *Accelerate* (DORA); Nagappan & Ball 2005 ICSE (relative churn); Peng et al. 2023 (Copilot RCT); METR 2025 arXiv:2507.09089; Murgia et al. 2025 arXiv:2507.00788; Goodhart 1975; Strathern 1997 *Eur Rev* 5:305; Poppendieck & Poppendieck 2003 *Lean Software Development*.
