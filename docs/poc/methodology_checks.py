#!/usr/bin/env python3
"""방법론 리뷰 재현 검사 (docs/methodology-review.md 근거) — 0토큰.

(1) Spearman 검정력 Bonett-Wright(2000) 보정 vs Pearson 공식.
(2) size over-control 민감도: raw↔라벨 vs 잔차↔라벨 (강화=confounder, 약화=mediator/over-control).
"""
import csv
import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from efficio.residual import residualize, size_factor  # noqa: E402
from efficio.store import Store  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
z = lambda r: np.arctanh(r)
Za, Zb = 1.959963, 0.841621


def avg_rank(x):
    x = np.asarray(x, float)
    _, inv, c = np.unique(x, return_inverse=True, return_counts=True)
    o = np.argsort(x, kind="mergesort"); r = np.empty(len(x)); r[o] = np.arange(1, len(x) + 1)
    s = np.zeros(len(c)); np.add.at(s, inv, r); return (s / c)[inv]


def sp(a, b):
    return float(np.corrcoef(avg_rank(a), avg_rank(b))[0, 1])


def main():
    print("=== (1) Spearman 검정력: Pearson vs Bonett-Wright(2000) 보정 n ===")
    for r in [0.3, 0.4, 0.5, 0.57]:
        nP = (Za + Zb) ** 2 / z(r) ** 2 + 3
        nBW = (1 + r * r / 2) * (Za + Zb) ** 2 / z(r) ** 2 + 3
        print(f"   참ρ={r}: Pearson n≈{nP:.0f} → 보정 n≈{nBW:.0f}")

    sp_path = os.path.join(HERE, "h1b_scores.csv")
    lp_path = os.path.join(HERE, "h1b_labels.csv")
    if not (os.path.exists(sp_path) and os.path.exists(lp_path)):
        print("\n(2) 스킵: h1b CSV 없음.")
        return
    scores = {int(r["idx"]): r for r in csv.DictReader(open(sp_path))}
    labels = {int(r["idx"]): float(r["label"]) for r in csv.DictReader(open(lp_path))}
    store = Store(); units = {u["session_id"][:8]: u for u in store.all_units()}; store.close()

    rows = [(labels[i], units[scores[i]["session"][:8]])
            for i in sorted(labels) if scores[i]["session"][:8] in units]
    if len(rows) < 8:
        print("\n(2) 스킵: 매칭 표본 부족."); return
    y = np.array([r[0] for r in rows])
    tok = np.array([r[1]["total_tokens"] for r in rows], float)
    size = size_factor(tok)
    print(f"\n=== (2) over-control 민감도 (n={len(rows)}) — 강화=confounder, 약화=over-control ===")
    for name, col in [("W2", "w2_raw"), ("WC", "wc_raw")]:
        v = np.array([r[1][col] for r in rows], float)
        print(f"   {name}: raw↔라벨 {sp(y, v):+.2f} → 잔차↔라벨 {sp(y, residualize(v, size)):+.2f}")
    print(f"   [참고] 라벨↔size ρ={sp(y, tok):+.2f}")


if __name__ == "__main__":
    main()
