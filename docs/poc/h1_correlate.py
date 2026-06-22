#!/usr/bin/env python3
"""
H1 기준타당도 상관분석 — 고정 시트(h1_scores.csv) 기반
====================================================
재선정 드리프트를 막기 위해, 사용자가 라벨한 그 시트(h1_scores.csv)에 직접 조인한다.
label: 1=헛수고 많음 / 2=보통 / 3=적음.  waste = 4-label (높을수록 헛수고 많음).
잔차 신호도 높을수록 낭비 의심. 임계: Spearman |ρ| ≥ 0.5.
"""
import csv
import os
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
with open(os.path.join(HERE, "h1_scores.csv")) as f:
    for row in csv.DictReader(f):
        scores[int(row["idx"])] = row

labels = {}
with open(os.path.join(HERE, "h1_labels.csv")) as f:
    for row in csv.DictReader(f):
        labels[int(row["idx"])] = int(row["label"])

idxs = sorted(i for i in labels if i in scores)
waste = np.array([4 - labels[i] for i in idxs], float)

print(f"라벨 n={len(idxs)}  (waste=4-label: 3=많음/2=보통/1=적음)\n")
print(f"{'#':>2} {'label':>5} {'waste':>5} {'composite':>10} {'r_W2':>12} {'r_W3':>7} {'r_WC':>8}  title")
for i in idxs:
    s = scores[i]
    print(f"{i:>2} {labels[i]:>5} {int(4-labels[i]):>5} {float(s['composite']):>10.1f} "
          f"{float(s['r_W2']):>12.0f} {float(s['r_W3']):>7.2f} {float(s['r_WC']):>8.2f}  {s['ai_title'][:34]}")

print("\n=== H1 상관 (Spearman ρ, vs 사람 waste 라벨) ===")
for key, name in [("composite", "합성 잔차점수"), ("r_W2", "잔차 W2"),
                  ("r_W3", "잔차 W3"), ("r_WC", "잔차 WC")]:
    v = np.array([float(scores[i][key]) for i in idxs], float)
    rho = spearman(waste, v)
    print(f"  {name:14s}: ρ = {rho:+.2f}   {'PASS(≥0.5)' if rho >= 0.5 else 'FAIL'}")

# 참고: raw 크기(tokens)·turns가 사람 라벨과 얼마나 상관되나(혼동 점검)
tok = np.array([float(scores[i]["tokens"]) for i in idxs], float)
trn = np.array([float(scores[i]["turns"]) for i in idxs], float)
print("\n  [참고] 사람 라벨 vs 크기 프록시:")
print(f"    tokens: ρ = {spearman(waste, tok):+.2f}   turns: ρ = {spearman(waste, trn):+.2f}")
