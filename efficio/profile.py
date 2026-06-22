"""효율 프로파일 산출 — W2 우위 (H1 검증 반영).

H1 결과(13.2): W2(재무효화) 잔차만 체감 기계적 낭비와 양의 상관 견고(ρ=0.57).
W3/WC는 약함 → 실험축으로 표기. 단일 종합점수 금지, 축별 자기대비 백분위 + 사례.
"""
from __future__ import annotations

import numpy as np

from .residual import residualize, size_factor, percentile_rank

# H1 검증 상태별 축 정의
AXES = [
    {"key": "w2", "raw": "w2_raw", "label": "컨텍스트 재무효화", "status": "validated"},
    {"key": "w3", "raw": "w3_raw", "label": "재탐색", "status": "experimental"},
    {"key": "wc", "raw": "wc_raw", "label": "편집 반복", "status": "experimental"},
]
PRIMARY = "w2"


def compute_residuals(units: list[dict]) -> list[dict]:
    """코퍼스 전체에 크기-잔차를 계산해 각 레코드에 r_<key>, size를 채운다."""
    if not units:
        return units
    size = size_factor([u["total_tokens"] for u in units])
    resids = {}
    for axis in AXES:
        resids[axis["key"]] = residualize([u[axis["raw"]] for u in units], size)
    out = []
    for i, u in enumerate(units):
        rec = dict(u)
        rec["size"] = float(size[i])
        for axis in AXES:
            k = axis["key"]
            rec[f"r_{k}"] = float(resids[k][i])
            rec[f"is_zero_{k}"] = (u[axis["raw"]] == 0)  # 0=신호없음 vs 데이터없음 구분
        out.append(rec)
    return out


def session_profile(units: list[dict], session_id: str) -> dict | None:
    """한 세션의 효율 프로파일. 자기 코퍼스 대비 백분위(높을수록 낭비 의심)."""
    enriched = compute_residuals(units)
    target = next((u for u in enriched if u["session_id"].startswith(session_id)), None)
    if target is None:
        return None
    axes = []
    for axis in AXES:
        k = axis["key"]
        col = [u[f"r_{k}"] for u in enriched]
        pct = percentile_rank(col, target[f"r_{k}"])
        axes.append({
            "key": k,
            "label": axis["label"],
            "status": axis["status"],
            "residual": round(target[f"r_{k}"], 2),
            "waste_percentile": round(pct, 0),  # 자기 분포에서 상위 몇 %나 낭비인가
            "is_zero": target[f"is_zero_{k}"],
        })
    return {
        "session_id": target["session_id"],
        "project": target["project"],
        "ai_title": target["ai_title"],
        "turns": target["turns"],
        "total_tokens": target["total_tokens"],
        "n_corpus": len(enriched),
        "axes": axes,
        "primary": PRIMARY,
    }


def timeline(units: list[dict], axis: str = PRIMARY, last_n: int = 20) -> list[dict]:
    """축의 잔차를 시간순으로. 자기대비 백분위 추세(개선/악화) 확인용."""
    enriched = compute_residuals(units)
    col = [u[f"r_{axis}"] for u in enriched]
    ordered = sorted(
        [u for u in enriched if u.get("ts_first")],
        key=lambda u: u["ts_first"],
    )[-last_n:]
    rows = []
    for u in ordered:
        rows.append({
            "session_id": u["session_id"][:8],
            "ts_first": u["ts_first"],
            "ai_title": u["ai_title"] or u["project"],
            "residual": round(u[f"r_{axis}"], 2),
            "waste_percentile": round(percentile_rank(col, u[f"r_{axis}"]), 0),
        })
    return rows
