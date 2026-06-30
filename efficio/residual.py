"""크기-잔차 정규화 (size-residualization).

원시 낭비 신호는 세션 크기에 종속(Pilot-0: raw ρ 0.74~0.94). 크기 인자에 로버스트
회귀(Theil–Sen)시킨 잔차만 "크기가 아닌 낭비"로 본다. OLS 금지(분포 비정규).
근거: docs/waste-aware-eval-design.md 3.2a, 13.1.

의존성: python3 stdlib만(math, statistics). numpy 미사용 — 어떤 python3로도 실행·번들 가능.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from statistics import median


def theil_sen(x: Sequence[float], y: Sequence[float]) -> tuple[float, float]:
    """단일 예측변수 Theil–Sen 적합. 반환 (intercept, slope).

    slope = 모든 쌍 기울기의 median, intercept = median(y - slope*x).
    중앙값 기반이라 numpy 버전과 수치 동일(짝수개=가운데 두 값 평균).
    """
    n = len(x)
    if n < 2:
        return (float(y[0]) if n else 0.0, 0.0)
    slopes: list[float] = []
    for i in range(n):
        xi, yi = x[i], y[i]
        for j in range(i + 1, n):
            dx = x[j] - xi
            if dx != 0:
                slopes.append((y[j] - yi) / dx)
    slope = median(slopes) if slopes else 0.0
    intercept = median([y[i] - slope * x[i] for i in range(n)])
    return float(intercept), float(slope)


def residualize(y: Sequence[float], size: Sequence[float]) -> list[float]:
    """y를 size(크기 인자)에 Theil–Sen 회귀시킨 잔차. 양(+)=같은 크기 대비 신호 초과."""
    a, b = theil_sen(size, y)
    return [float(yi) - (a + b * float(si)) for yi, si in zip(y, size)]


def size_factor(total_tokens: Sequence[float]) -> list[float]:
    """크기 변수 = log(total_tokens + 1). 13장 PCA의 PC1 대용."""
    return [math.log(float(t) + 1.0) for t in total_tokens]


def percentile_rank(values: Sequence[float], target: float) -> float:
    """target이 values 분포에서 차지하는 백분위(0~100). 자기 대비용. 빈 분포는 nan."""
    n = len(values)
    if n == 0:
        return float("nan")
    return sum(1 for v in values if v < target) / n * 100.0
