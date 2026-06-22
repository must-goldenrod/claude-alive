"""효율 프로파일 산출 — 고정 기준 모델 적용 (W2 우위).

잔차/백분위는 *고정 기준 모델*(reference.py)로만 계산한다. 코퍼스가 늘어도
같은 세션 점수가 불변(재현성). 단일 종합점수 금지, 축별 자기대비 백분위 + 사례.
H1 결과(13.2): W2만 검증, W3·WC는 실험축.
"""
from __future__ import annotations

from .reference import AXES, PRIMARY, apply_reference


def session_profile(units: list, session_id: str, model: dict):
    """한 세션의 효율 프로파일. 고정 모델 대비 잔차/백분위(높을수록 낭비 의심)."""
    target = next((u for u in units if u["session_id"].startswith(session_id)), None)
    if target is None:
        return None
    applied = apply_reference(model, target)
    axes = []
    for ax in AXES:
        k = ax["key"]
        axes.append({
            "key": k,
            "label": ax["label"],
            "status": ax["status"],
            "cluster": ax.get("cluster", ""),
            "residual": round(applied[f"r_{k}"], 2),
            "waste_percentile": round(applied[f"pct_{k}"], 0),
            "is_zero": applied[f"is_zero_{k}"],
        })
    return {
        "session_id": target["session_id"],
        "project": target["project"],
        "ai_title": target["ai_title"],
        "turns": target["turns"],
        "total_tokens": target["total_tokens"],
        "model_version": model.get("model_version"),
        "model_n": model.get("n"),
        "axes": axes,
        "primary": PRIMARY,
    }


def timeline(units: list, model: dict, axis: str = PRIMARY, last_n: int = 20) -> list:
    """축 잔차를 시간순으로(고정 모델 적용). 자기대비 백분위 추세 확인용."""
    ordered = sorted(
        [u for u in units if u.get("ts_first")],
        key=lambda u: u["ts_first"],
    )[-last_n:]
    rows = []
    for u in ordered:
        applied = apply_reference(model, u)
        rows.append({
            "session_id": u["session_id"][:8],
            "ts_first": u["ts_first"],
            "ai_title": u["ai_title"] or u["project"],
            "residual": round(applied[f"r_{axis}"], 2),
            "waste_percentile": round(applied[f"pct_{axis}"], 0),
        })
    return rows
