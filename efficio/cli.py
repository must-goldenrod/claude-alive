"""Efficio M0 CLI — collect / profile / timeline.

  python -m efficio collect              # ~/.claude/projects 스캔 → SQLite 영속화
  python -m efficio timeline [--last N]  # 주축(W2) 잔차 시계열
  python -m efficio profile <session>    # 한 세션 효율 프로파일

전 과정 0 토큰(LLM 미사용). 단일세션 WU + W2 우위(H1 검증).
"""
from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timezone

from .profile import AXES, PRIMARY, session_profile, timeline
from .signals import extract_session, iter_sessions
from .store import DEFAULT_DB, Store

DEFAULT_PROJECTS = os.path.expanduser("~/.claude/projects")
_STATUS_MARK = {"validated": "✓검증", "experimental": "·실험"}


def cmd_collect(args) -> int:
    store = Store(args.db)
    now = time.time()
    scanned = ingested = 0
    for path in iter_sessions(args.projects):
        scanned += 1
        rec = extract_session(path)
        if rec is None:
            continue
        store.upsert(rec, ingested_at=now)
        ingested += 1
    store.commit()
    total = store.count()
    store.close()
    print(f"스캔 {scanned}개 · 수집(범위 통과) {ingested}개 · 저장소 누적 {total}개")
    print(f"DB: {args.db}")
    return 0


def cmd_timeline(args) -> int:
    store = Store(args.db)
    units = store.all_units()
    store.close()
    if not units:
        print("저장된 세션 없음. 먼저 `collect` 실행.")
        return 1
    rows = timeline(units, axis=args.axis, last_n=args.last)
    axis_label = next(a["label"] for a in AXES if a["key"] == args.axis)
    print(f"=== {axis_label}({args.axis}) 잔차 시계열 — 최근 {len(rows)}개 (백분위↑=낭비↑) ===")
    print(f"{'date':10s} {'pct':>4} {'resid':>12}  title")
    for r in rows:
        d = _fmt_date(r["ts_first"])
        print(f"{d:10s} {int(r['waste_percentile']):>3}% {r['residual']:>12.1f}  {r['ai_title'][:42]}")
    return 0


def cmd_profile(args) -> int:
    store = Store(args.db)
    units = store.all_units()
    store.close()
    prof = session_profile(units, args.session)
    if prof is None:
        print(f"세션 '{args.session}' 없음. `collect` 했는지, id 접두어가 맞는지 확인.")
        return 1
    print(f"=== 효율 프로파일: {prof['ai_title'] or prof['project']} ===")
    print(f"session={prof['session_id'][:8]} · turns={prof['turns']} · "
          f"tokens={prof['total_tokens']:,} · 자기코퍼스 n={prof['n_corpus']}")
    print(f"{'축':16s} {'상태':6s} {'낭비백분위':>9s} {'잔차':>12s}")
    for ax in prof["axes"]:
        primary = " ◀주축" if ax["key"] == prof["primary"] else ""
        pct = "  (0=신호없음)" if ax["is_zero"] else ""
        print(f"{ax['label']:16s} {_STATUS_MARK[ax['status']]:6s} "
              f"{int(ax['waste_percentile']):>8}% {ax['residual']:>12.1f}{primary}{pct}")
    print("\n해석: 주축 W2(컨텍스트 재무효화)만 H1 검증됨(ρ≈0.5, n=30 파일럿). "
          "W3·WC는 실험축. 방향 타당성은 측정 안 함.")
    return 0


def _fmt_date(ts) -> str:
    if not ts:
        return "?"
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="efficio", description="Claude Code 세션 크기보정 낭비 신호 (M0)")
    p.add_argument("--db", default=DEFAULT_DB, help=f"SQLite 경로 (기본 {DEFAULT_DB})")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("collect", help="세션 스캔 → 영속화")
    c.add_argument("--projects", default=DEFAULT_PROJECTS)
    c.set_defaults(func=cmd_collect)

    t = sub.add_parser("timeline", help="주축 잔차 시계열")
    t.add_argument("--axis", default=PRIMARY, choices=[a["key"] for a in AXES])
    t.add_argument("--last", type=int, default=20)
    t.set_defaults(func=cmd_timeline)

    pr = sub.add_parser("profile", help="한 세션 프로파일")
    pr.add_argument("session", help="session_id (접두어 가능)")
    pr.set_defaults(func=cmd_profile)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)
