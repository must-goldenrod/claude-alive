#!/usr/bin/env python3
"""방법론 보정 도구 — EFA(PCA 보완) + 평정자간 신뢰도·약화보정 (0토큰).

(A) EFA-lite: 잔차 신호({w2,wc,bash,w3})의 상관행렬 고유값으로 요인 수(Kaiser)와
    제1·2요인 분산을 본다. PCA(총분산)와 달리 '낭비가 1차원인가 2차원인가'를 점검.
    MTMM(13.5)이 2차원이라 했으니 EFA에서도 요인 2개가 뜨면 상호 보강.
(B) 평정자간 신뢰도·약화보정: ICC(2,1) + 2차 가중 κ + Spearman(1904) 약화보정.
    라운드3에서 ≥2 평정자 라벨이 생기면 그대로 적용. 지금은 합성 데이터로 자기검증.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from efficio.reference import apply_reference  # noqa: E402
from efficio.store import Store  # noqa: E402


# ---------- (A) EFA-lite ----------
def efa_lite():
    store = Store(); units = store.all_units(); model = store.load_reference(); store.close()
    if not units or model is None:
        print("(A) 스킵: DB/모델 없음."); return
    axes = ["w2", "wc", "bash", "w3"]
    cols = {a: [] for a in axes}
    for u in units:
        ap = apply_reference(model, u)
        for a in axes:
            if f"r_{a}" in ap:
                cols[a].append(ap[f"r_{a}"])
    have = [a for a in axes if len(cols[a]) == len(units)]
    X = np.column_stack([cols[a] for a in have]).astype(float)
    sd = X.std(0, ddof=1); sd[sd == 0] = 1
    R = np.corrcoef(((X - X.mean(0)) / sd), rowvar=False)
    eig = np.sort(np.linalg.eigvalsh(R))[::-1]
    kaiser = int((eig > 1).sum())
    print(f"(A) EFA-lite — 잔차 신호 {have}, n={len(units)}")
    print(f"    상관행렬 고유값: {np.round(eig, 2).tolist()}")
    print(f"    Kaiser 요인 수(고유값>1): {kaiser}  → {'2차원 이상(MTMM 보강)' if kaiser >= 2 else '1차원'}")
    print(f"    제1요인 {eig[0] / len(have) * 100:.0f}% · 제2요인 {eig[1] / len(have) * 100:.0f}% 분산")
    print(f"    상관행렬:\n{np.round(R, 2)}\n")


# ---------- (B) 평정자간 신뢰도 + 약화보정 ----------
def icc_2_1(ratings):
    """ICC(2,1): two-way random, single rater, absolute agreement. ratings: n×k."""
    r = np.asarray(ratings, float); n, k = r.shape
    gm = r.mean()
    ms_rows = k * ((r.mean(1) - gm) ** 2).sum() / (n - 1)
    ms_cols = n * ((r.mean(0) - gm) ** 2).sum() / (k - 1)
    ss_tot = ((r - gm) ** 2).sum()
    ms_err = (ss_tot - k * ((r.mean(1) - gm) ** 2).sum() - n * ((r.mean(0) - gm) ** 2).sum()) / ((n - 1) * (k - 1))
    return (ms_rows - ms_err) / (ms_rows + (k - 1) * ms_err + k * (ms_cols - ms_err) / n)


def weighted_kappa(a, b, n_cats=5):
    """2차(quadratic) 가중 κ — 순서형 평정자 일치."""
    a = np.asarray(a, int); b = np.asarray(b, int)
    cats = np.arange(1, n_cats + 1)
    O = np.zeros((n_cats, n_cats))
    for x, y in zip(a, b):
        O[x - 1, y - 1] += 1
    O /= O.sum()
    ra = O.sum(1); rb = O.sum(0)
    E = np.outer(ra, rb)
    W = (cats[:, None] - cats[None, :]) ** 2 / (n_cats - 1) ** 2
    return 1 - (W * O).sum() / (W * E).sum()


def attenuation_corrected(rho_obs, reliability):
    """Spearman(1904) 약화보정: ρ_true = ρ_obs / √reliability (criterion만 보정)."""
    return rho_obs / np.sqrt(reliability) if reliability > 0 else float("nan")


def reliability_demo():
    print("(B) 평정자간 신뢰도·약화보정 — 합성 2평정자 자기검증")
    rng = np.random.RandomState(0)
    true = rng.normal(0, 1, 40)
    r1 = np.clip(np.round(3 + true + rng.normal(0, 0.6, 40)), 1, 5)
    r2 = np.clip(np.round(3 + true + rng.normal(0, 0.6, 40)), 1, 5)
    ratings = np.column_stack([r1, r2])
    icc = icc_2_1(ratings)
    wk = weighted_kappa(r1.astype(int), r2.astype(int))
    print(f"    ICC(2,1)={icc:.2f} · 2차가중 κ={wk:.2f} (합성, 라운드3엔 실제 라벨 투입)")
    print(f"    약화보정 예: 관측 ρ=0.57, 신뢰도={icc:.2f} → 보정 ρ={attenuation_corrected(0.57, icc):.2f}")
    print("    (소표본·저신뢰도 시 보정 과대 주의 — 부트스트랩 CI 병행 권장)")


if __name__ == "__main__":
    efa_lite()
    reliability_demo()
