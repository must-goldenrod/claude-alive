#!/usr/bin/env python3
"""자기점검 #2 — W2가 '낭비'인가 '작업 유형'인가 (교란 검증, 0토큰).

의심: 실데이터에서 W2 상위가 모두 MPC 정산/검증 세션. 이런 작업은 본질적으로 큰
맥락을 반복 주입(필요한 재주입 ≠ 헛수고)할 수 있어, H1의 W2↔라벨 상관이 '작업 유형
군집'에 의해 부풀려졌을 수 있다. 프로젝트를 작업유형 대리로 보고 통제한다.

(A) 전체 코퍼스: W2 잔차 분산 중 프로젝트가 설명하는 비율(eta², 순위 기반).
(B) H1 라벨셋: W2↔라벨 상관을 within-project / between-project로 분해.
    - within ρ ~ overall ρ  → 같은 유형 내에서도 낭비 추적(교란 아님)
    - within ρ ~ 0, between ρ 큼 → W2는 작업유형 대리(교란)
"""
import csv
import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from efficio.reference import apply_reference  # noqa: E402
from efficio.store import Store  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def avg_rank(x):
    x = np.asarray(x, float)
    _, inv, counts = np.unique(x, return_inverse=True, return_counts=True)
    order = np.argsort(x, kind="mergesort")
    r = np.empty(len(x)); r[order] = np.arange(1, len(x) + 1)
    s = np.zeros(len(counts)); np.add.at(s, inv, r)
    return (s / counts)[inv]


def spearman(a, b):
    return float(np.corrcoef(avg_rank(a), avg_rank(b))[0, 1])


def eta_squared_by_group(values, groups):
    """순위 기반 eta²: group이 values 순위 분산을 설명하는 비율(0~1)."""
    r = avg_rank(values)
    grand = r.mean()
    ss_total = ((r - grand) ** 2).sum()
    ss_between = 0.0
    for g in set(groups):
        idx = [i for i, gg in enumerate(groups) if gg == g]
        rg = r[idx]
        ss_between += len(idx) * (rg.mean() - grand) ** 2
    return ss_between / ss_total if ss_total > 0 else 0.0


# ---------- (A) 전체 코퍼스 ----------
def corpus_analysis():
    store = Store()
    units = store.all_units()
    model = store.load_reference()
    store.close()
    if not units or model is None:
        print("(A) 스킵: efficio DB 비었거나 모델 없음. `efficio collect` 먼저.")
        return
    r_w2, projects = [], []
    for u in units:
        r_w2.append(apply_reference(model, u)["r_w2"])
        projects.append(u["project"])
    eta2 = eta_squared_by_group(r_w2, projects)
    print(f"(A) 전체 코퍼스 n={len(units)}, 프로젝트 {len(set(projects))}개")
    print(f"    W2 잔차 분산 중 프로젝트(작업유형)가 설명: eta² = {eta2:.2f}")
    print(f"    해석: 1에 가까울수록 W2가 '어느 프로젝트냐'로 결정됨(=작업유형 교란 강함)")
    # 프로젝트별 W2 중앙값 상위
    by_proj = {}
    for rr, p in zip(r_w2, projects):
        by_proj.setdefault(p, []).append(rr)
    med = sorted(((np.median(v), p, len(v)) for p, v in by_proj.items()
                  if len(v) >= 3), reverse=True)
    print("    프로젝트별 W2잔차 중앙값(n>=3) 상위 5:")
    for m, p, c in med[:5]:
        print(f"      {p[:34]:34s} median={m:>12.0f} (n={c})")
    print()


# ---------- (B) H1 라벨셋 within/between ----------
def labeled_analysis():
    sp = os.path.join(HERE, "h1b_scores.csv")
    lp = os.path.join(HERE, "h1b_labels.csv")
    if not (os.path.exists(sp) and os.path.exists(lp)):
        print("(B) 스킵: h1b_scores.csv / h1b_labels.csv 없음.")
        return
    scores = {int(r["idx"]): r for r in csv.DictReader(open(sp))}
    labels = {int(r["idx"]): float(r["label"]) for r in csv.DictReader(open(lp))}
    idx = sorted(i for i in labels if i in scores)
    w2 = np.array([float(scores[i]["r_W2"]) for i in idx])
    y = np.array([labels[i] for i in idx])
    proj = [scores[i]["project"] for i in idx]

    overall = spearman(w2, y)
    eta2 = eta_squared_by_group(w2, proj)
    print(f"(B) H1 라벨셋 n={len(idx)}")
    from collections import Counter
    print(f"    프로젝트 분포: {dict(Counter(proj))}")
    print(f"    전체 ρ(W2, label) = {overall:+.2f}")
    print(f"    W2가 프로젝트로 설명되는 정도: eta² = {eta2:.2f}")

    # within-project: 프로젝트 평균을 뺀 편차끼리 상관(작업유형 통제). n>=2 프로젝트만.
    counts = Counter(proj)
    keep = [k for i, k in enumerate(idx) if counts[proj[i]] >= 2]
    if len(keep) >= 5:
        sub = [(j, p) for j, p in zip(idx, proj) if counts[p] >= 2]
        w2s = np.array([float(scores[j]["r_W2"]) for j, _ in sub])
        ys = np.array([labels[j] for j, _ in sub])
        ps = [p for _, p in sub]
        pm_w2 = {p: w2s[[k for k, pp in enumerate(ps) if pp == p]].mean() for p in set(ps)}
        pm_y = {p: ys[[k for k, pp in enumerate(ps) if pp == p]].mean() for p in set(ps)}
        dev_w2 = np.array([w2s[k] - pm_w2[ps[k]] for k in range(len(ps))])
        dev_y = np.array([ys[k] - pm_y[ps[k]] for k in range(len(ps))])
        within = spearman(dev_w2, dev_y)
        print(f"    within-project ρ (작업유형 통제, n={len(ps)}, {len(set(ps))}개 프로젝트) = {within:+.2f}")
    else:
        print("    within-project: n>=2 프로젝트 표본 부족 → 계산 생략")

    # between-project: 프로젝트 평균끼리
    uprojs = sorted(set(proj))
    if len(uprojs) >= 3:
        mw = [w2[[k for k, p in enumerate(proj) if p == up]].mean() for up in uprojs]
        my = [y[[k for k, p in enumerate(proj) if p == up]].mean() for up in uprojs]
        between = spearman(mw, my)
        print(f"    between-project ρ (프로젝트 평균끼리, {len(uprojs)}개) = {between:+.2f}")
    print()
    print("    판정 가이드: within ρ가 전체 ρ와 비슷하면 '같은 작업유형 내에서도 낭비 추적'")
    print("    → 교란 아님. within ρ≈0이고 between ρ만 크면 → W2는 작업유형 대리(교란).")


if __name__ == "__main__":
    corpus_analysis()
    labeled_analysis()
