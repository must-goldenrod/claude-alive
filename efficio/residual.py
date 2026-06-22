"""크기-잔차 정규화 (size-residualization).

원시 낭비 신호는 세션 크기에 종속(Pilot-0: raw ρ 0.74~0.94). 크기 인자에 로버스트
회귀(Theil–Sen)시킨 잔차만 "크기가 아닌 낭비"로 본다. OLS 금지(분포 비정규).
근거: docs/waste-aware-eval-design.md 3.2a, 13.1.
"""
from __future__ import annotations

import numpy as np


def theil_sen(x, y) -> tuple[float, float]:
    """단일 예측변수 Theil–Sen 적합. 반환 (intercept, slope).

    slope = 모든 쌍 기울기의 median, intercept = median(y - slope*x).
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(x)
    if n < 2:
        return (float(y[0]) if n else 0.0, 0.0)
    slopes: list[float] = []
    for i in range(n):
        dx = x[i + 1:] - x[i]
        dy = y[i + 1:] - y[i]
        mask = dx != 0
        if mask.any():
            slopes.extend((dy[mask] / dx[mask]).tolist())
    slope = float(np.median(slopes)) if slopes else 0.0
    intercept = float(np.median(y - slope * x))
    return intercept, slope


def residualize(y, size) -> np.ndarray:
    """y를 size(크기 인자)에 Theil–Sen 회귀시킨 잔차. 양(+)=같은 크기 대비 신호 초과."""
    a, b = theil_sen(size, y)
    return np.asarray(y, dtype=float) - (a + b * np.asarray(size, dtype=float))


def size_factor(total_tokens) -> np.ndarray:
    """크기 변수 = log(total_tokens + 1). 13장 PCA의 PC1 대용."""
    return np.log(np.asarray(total_tokens, dtype=float) + 1.0)


def percentile_rank(values, target) -> float:
    """target이 values 분포에서 차지하는 백분위(0~100). 자기 대비용."""
    values = np.asarray(values, dtype=float)
    if len(values) == 0:
        return float("nan")
    return float((values < target).mean() * 100.0)
