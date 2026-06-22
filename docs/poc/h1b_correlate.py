#!/usr/bin/env python3
"""H1 라운드2 상관 — 고정 시트(h1b_scores.csv) 기반.
label 1=매끄러움..5=헛수고많음 (높을수록 낭비). 잔차도 높을수록 낭비. 임계 +0.5."""
import csv, os
import numpy as np
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


scores = {}
with open(os.path.join(HERE, "h1b_scores.csv")) as f:
    for row in csv.DictReader(f):
        scores[int(row["idx"])] = row
labels = {}
with open(os.path.join(HERE, "h1b_labels.csv")) as f:
    for row in csv.DictReader(f):
        labels[int(row["idx"])] = float(row["label"])

idxs = sorted(i for i in labels if i in scores)
waste = np.array([labels[i] for i in idxs], float)
print(f"라벨 n={len(idxs)} (1=매끄러움..5=헛수고많음)")
print(f"라벨 분포: {dict(zip(*[x.tolist() for x in np.unique(waste, return_counts=True)]))}\n")

print("=== H1 라운드2 상관 (Spearman ρ, 잔차 높을수록 낭비 → +ρ 기대) ===")
for key, name in [("composite", "합성 잔차점수"), ("r_W2", "잔차 W2"),
                  ("r_W3", "잔차 W3"), ("r_WC", "잔차 WC")]:
    v = np.array([float(scores[i][key]) for i in idxs], float)
    rho = spearman(waste, v)
    print(f"  {name:14s}: ρ = {rho:+.2f}   {'PASS(≥0.5)' if rho >= 0.5 else 'FAIL'}")

tok = np.array([float(scores[i]["tokens"]) for i in idxs], float)
trn = np.array([float(scores[i]["turns"]) for i in idxs], float)
tls = np.array([float(scores[i]["tools"]) for i in idxs], float)
print(f"\n  [참고] 라벨 vs raw 크기 — tokens ρ={spearman(waste,tok):+.2f}  "
      f"turns ρ={spearman(waste,trn):+.2f}  tools ρ={spearman(waste,tls):+.2f}")
