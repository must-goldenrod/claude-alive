"""기준 모델(reference model) — 잔차 드리프트 고정.

문제: 잔차/백분위를 매번 전체 코퍼스로 재적합하면, 세션이 늘 때마다 같은 세션의
점수가 바뀐다(재현성 결함). 해결: 기준 모델(축별 Theil–Sen 계수 + 기준 잔차 분포)을
1회 적합해 고정하고, 채점은 이 고정 모델을 *적용*만 한다. 재적합은 명시적 행위.
"""
from __future__ import annotations

import numpy as np

from .residual import percentile_rank, size_factor, theil_sen

# 검증 상태·축군(13.2~13.5). 단일 '주축' 없음 — MTMM에서 2차원(체감/행동)이 갈림(13.5).
#   cluster 체감 = 주관 라벨과 수렴(W2)   cluster 행동 = 객관 rework/Bash와 수렴(WC·Bash)
#   status subj=주관검증 · obj-weak=객관약검증 · none=미검증
AXES = [
    {"key": "w2", "raw": "w2_raw", "label": "컨텍스트 재무효화", "status": "subj", "cluster": "체감"},
    {"key": "wc", "raw": "wc_raw", "label": "편집 반복", "status": "obj-weak", "cluster": "행동"},
    {"key": "bash", "raw": "bash_raw", "label": "Bash 시행착오", "status": "obj-weak", "cluster": "행동"},
    {"key": "w3", "raw": "w3_raw", "label": "재탐색", "status": "none", "cluster": "행동"},
]
# 기본 표시 축(검증 우위 아님; 신호 밀도가 높은 체감축을 기본값으로).
PRIMARY = "w2"


def fit_reference(units: list, fit_at: float, axes=AXES) -> dict:
    """기준집합 units로 축별 (intercept, slope) + 기준 잔차 분포를 적합한다.

    반환은 JSON 직렬화 가능한 모델 dict. 이 모델은 이후 불변으로 취급한다.
    """
    size = size_factor([u["total_tokens"] for u in units]) if units else np.array([])
    model = {
        "fit_at": fit_at,
        "n": len(units),
        "size_var": "log_total_tokens",
        "axes": {},
    }
    for ax in axes:
        raw = np.array([u[ax["raw"]] for u in units], dtype=float)
        intercept, slope = theil_sen(size, raw)
        residuals = (raw - (intercept + slope * size)).tolist() if len(raw) else []
        model["axes"][ax["key"]] = {
            "raw": ax["raw"],
            "label": ax["label"],
            "status": ax["status"],
            "intercept": float(intercept),
            "slope": float(slope),
            "ref_residuals": sorted(residuals),  # 백분위 조회용 고정 분포
        }
    return model


def apply_reference(model: dict, unit: dict) -> dict:
    """고정 모델을 한 세션에 적용 → 축별 잔차/백분위/0여부. 코퍼스와 무관(불변)."""
    size = float(np.log(unit["total_tokens"] + 1.0))
    out = {}
    for key, m in model["axes"].items():
        raw = unit[m["raw"]]
        baseline = m["intercept"] + m["slope"] * size   # 같은 크기의 '예상' 신호(반사실 기준선)
        resid = raw - baseline                          # 회피가능 초과분 = 실제 − 기준선
        out[f"r_{key}"] = resid
        out[f"base_{key}"] = baseline
        out[f"raw_{key}"] = raw
        out[f"pct_{key}"] = percentile_rank(m["ref_residuals"], resid)
        out[f"is_zero_{key}"] = (raw == 0)
    return out
