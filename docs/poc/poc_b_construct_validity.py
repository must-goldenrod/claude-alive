#!/usr/bin/env python3
"""
정량 검증 — 구성타당도(Construct Validity) 분석
==============================================
질문(C1/C3/C4): 무료 결정론 "낭비" 지표들이 잠재변수 '회피 가능한 낭비'를 재는가,
아니면 단일 '세션 크기/활동량' 인자로 환원되는가?

방법(0 토큰, 로컬 CSV만):
  1) Spearman 상관행렬 (순위변환 후 Pearson) — 비정규·영과잉 분포에 강건
  2) PCA (표준화 후 고유값분해) — PC1이 분산을 지배하면 '단일 인자' 증거
  3) 초점 검정: 후보 낭비지표(W2/W3/edit_churn)가 크기 프록시와 얼마나 상관되나
  4) 낭비지표 상호 상관(다중공선성/중복성)

입력: docs/poc/poc_a_results.csv
주의: n=40, 표본이 보안리뷰/도구개발 세션에 편중됐을 수 있어 일반화는 제한적.
"""
import csv
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "poc_a_results.csv")

# 분석 변수
SIZE = ["tokens_total", "tool_calls", "reads", "turns", "edits"]
WASTE = ["W2_context_waste", "W3_read_redundancy", "edit_churn"]
ALLVARS = SIZE + WASTE


def avg_rank(x):
    """평균 순위(동점 처리)."""
    x = np.asarray(x, dtype=float)
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(len(x), dtype=float)
    ranks[order] = np.arange(1, len(x) + 1)
    # 동점 평균
    _, inv, counts = np.unique(x, return_inverse=True, return_counts=True)
    sums = np.zeros(len(counts))
    np.add.at(sums, inv, ranks)
    means = sums / counts
    return means[inv]


def spearman_matrix(data, cols):
    R = np.column_stack([avg_rank(data[c]) for c in cols])
    # Pearson on ranks
    return np.corrcoef(R, rowvar=False)


def load():
    rows = []
    with open(CSV) as f:
        for r in csv.DictReader(f):
            rows.append(r)
    data = {}
    for c in ALLVARS:
        data[c] = np.array([float(r[c]) for r in rows], dtype=float)
    return data, len(rows)


def pca(data, cols):
    X = np.column_stack([data[c] for c in cols]).astype(float)
    # 표준화
    mu = X.mean(axis=0)
    sd = X.std(axis=0, ddof=1)
    sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    # 상관기반 PCA = 표준화 데이터의 공분산 고유분해
    C = np.cov(Z, rowvar=False)
    eigval, eigvec = np.linalg.eigh(C)
    idx = np.argsort(eigval)[::-1]
    eigval = eigval[idx]
    eigvec = eigvec[:, idx]
    var_explained = eigval / eigval.sum()
    return eigval, eigvec, var_explained


def fmt_matrix(M, labels):
    short = [l.replace("_context_waste", "_ctx").replace("_read_redundancy", "_rd")
             .replace("tokens_total", "tokens").replace("tool_calls", "tools")
             .replace("edit_churn", "echurn")[:8] for l in labels]
    out = ["       " + " ".join(f"{s:>8}" for s in short)]
    for i, l in enumerate(short):
        row = " ".join(f"{M[i, j]:>8.2f}" for j in range(len(short)))
        out.append(f"{l:>6} {row}")
    return "\n".join(out)


def main():
    data, n = load()
    print(f"표본 n = {n}\n")

    # 1) Spearman 상관행렬
    S = spearman_matrix(data, ALLVARS)
    print("=== 1) Spearman 상관행렬 (전체 변수) ===")
    print(fmt_matrix(S, ALLVARS))
    print()

    # 3) 초점 검정: 낭비지표 vs 크기 프록시
    print("=== 3) 초점 검정 — 후보 낭비지표 × 크기 프록시 (Spearman ρ) ===")
    idx = {c: i for i, c in enumerate(ALLVARS)}
    header = "낭비지표\\크기   " + " ".join(f"{s.replace('tokens_total','tokens').replace('tool_calls','tools')[:7]:>7}" for s in SIZE)
    print(header)
    for w in WASTE:
        cells = " ".join(f"{S[idx[w], idx[s]]:>7.2f}" for s in SIZE)
        print(f"{w[:14]:14s} {cells}")
    print()

    # 4) 낭비지표 상호 상관
    print("=== 4) 낭비지표 상호 상관 (중복성 점검) ===")
    for i in range(len(WASTE)):
        for j in range(i + 1, len(WASTE)):
            print(f"  {WASTE[i]:20s} × {WASTE[j]:20s} : ρ = {S[idx[WASTE[i]], idx[WASTE[j]]]:.2f}")
    print()

    # 2) PCA — 전체 변수
    eigval, eigvec, ve = pca(data, ALLVARS)
    print("=== 2) PCA (표준화 8변수) — 분산 설명 ===")
    cum = 0.0
    for k in range(len(ve)):
        cum += ve[k]
        print(f"  PC{k+1}: 고유값={eigval[k]:.2f}  분산설명={ve[k]*100:5.1f}%  누적={cum*100:5.1f}%")
    print()
    print("  PC1 적재량(loadings) — 부호·크기:")
    for i, c in enumerate(ALLVARS):
        bar = "█" * int(abs(eigvec[i, 0]) * 30)
        print(f"    {c:20s} {eigvec[i,0]:+.2f}  {bar}")
    print()
    print("  PC2 적재량:")
    for i, c in enumerate(ALLVARS):
        print(f"    {c:20s} {eigvec[i,1]:+.2f}")
    print()

    # 2b) PCA — 크기 프록시만 빼고 낭비지표끼리
    eig2, vec2, ve2 = pca(data, WASTE)
    print("=== 2b) PCA (낭비지표 3개만) — 이들이 단일 인자인가? ===")
    cum = 0.0
    for k in range(len(ve2)):
        cum += ve2[k]
        print(f"  PC{k+1}: 분산설명={ve2[k]*100:5.1f}%  누적={cum*100:5.1f}%")
    print()
    print("CSV 입력: docs/poc/poc_a_results.csv")


if __name__ == "__main__":
    main()
