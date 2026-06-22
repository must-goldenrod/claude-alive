#!/usr/bin/env python3
"""자기점검 #4b — WC↔rework가 진짜인가 구성 중첩(tautology)인가 (0토큰).

#4에서 WC 잔차 ↔ 객관 rework(RW) ρ=+0.25(robust). 그러나 WC(세션 내 반복편집)와
RW(세션 간 재편집)는 둘 다 '같은 파일 반복편집'이라 부분 tautology 의심.

검정: 세션 편집파일을 세션내 1회(single)/반복(multi)로 분리.
  - RW_single = single 파일이 후속세션에 재편집된 비율 (WC가 만든 파일 제외)
  - RW_multi  = multi 파일이 후속세션에 재편집된 비율 (WC 기여 파일)
판정: WC↔RW_single 양이면 WC는 single까지 예측 → 세션수준 churn 신호(중첩 아님).
      RW_single≈0이고 RW_multi만 양이면 → tautology(자기가 센 파일만 예측).
보조: WC·RW를 편집파일수에 잔차화한 부분상관.
"""
import glob
import json
import os
import sys
from collections import Counter
from datetime import datetime

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from efficio.residual import residualize, size_factor  # noqa: E402

PROJECTS = os.path.expanduser("~/.claude/projects")
WINDOW = 259200  # 3일
MIN_TURNS, MIN_ASSIST = 3, 4
MIN_SINGLE = 2
_EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}


def _epoch(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def parse(path):
    usage = {}
    edit_paths = []
    turns = assist = 0
    cwd = ""
    ts_first = ts_last = None
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("cwd") and not cwd:
                    cwd = e["cwd"]
                ep = _epoch(e.get("timestamp"))
                if ep:
                    if ts_first is None:
                        ts_first = ep
                    ts_last = ep
                t = e.get("type")
                if t == "user":
                    m = e.get("message", {}); c = m.get("content")
                    real = isinstance(c, str) or (isinstance(c, list) and any(
                        isinstance(b, dict) and b.get("type") == "text" for b in c))
                    if real and not e.get("isSidechain"):
                        turns += 1
                elif t == "assistant":
                    assist += 1
                    m = e.get("message", {}); mid, u = m.get("id"), m.get("usage")
                    if mid and u:
                        usage[mid] = u
                    for b in (m.get("content") or []):
                        if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in _EDIT_TOOLS:
                            inp = b.get("input") or {}
                            fp = inp.get("file_path") or inp.get("notebook_path")
                            if fp:
                                edit_paths.append(fp)
    except OSError:
        return None
    if ts_first is None:
        return None
    cc = inp = out = cr = 0; cc_list = []
    for u in usage.values():
        inp += u.get("input_tokens", 0) or 0
        out += u.get("output_tokens", 0) or 0
        c = u.get("cache_creation_input_tokens", 0) or 0
        cc += c; cc_list.append(c)
        cr += u.get("cache_read_input_tokens", 0) or 0
    counts = Counter(edit_paths)
    return {
        "cwd": cwd, "ts_first": ts_first, "ts_last": ts_last,
        "turns": turns, "assist": assist,
        "total_tokens": inp + out + cc + cr,
        "wc_raw": len(edit_paths) - len(counts),
        "edit_files": set(counts),
        "single_files": {f for f, c in counts.items() if c == 1},
        "multi_files": {f for f, c in counts.items() if c > 1},
        "n_edit_files": len(counts),
    }


def avg_rank(x):
    x = np.asarray(x, float)
    _, inv, counts = np.unique(x, return_inverse=True, return_counts=True)
    order = np.argsort(x, kind="mergesort")
    r = np.empty(len(x)); r[order] = np.arange(1, len(x) + 1)
    s = np.zeros(len(counts)); np.add.at(s, inv, r)
    return (s / counts)[inv]


def spearman(a, b):
    return float(np.corrcoef(avg_rank(a), avg_rank(b))[0, 1])


def follow_edits(session, all_sessions, window):
    fe = set()
    for o in all_sessions:
        if o is session or o["cwd"] != session["cwd"]:
            continue
        if session["ts_last"] < o["ts_first"] <= session["ts_last"] + window:
            fe |= o["edit_files"]
    return fe


def main():
    files = [p for p in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl"))
             if os.sep + "subagents" + os.sep not in p]
    sessions = [r for p in files if (r := parse(p))]
    homo = [s for s in sessions if s["turns"] >= MIN_TURNS and s["assist"] >= MIN_ASSIST]
    size = size_factor([s["total_tokens"] for s in homo])
    r_wc = residualize([s["wc_raw"] for s in homo], size)
    for i, s in enumerate(homo):
        s["r_wc"] = r_wc[i]

    sample = []
    for s in homo:
        if len(s["single_files"]) < MIN_SINGLE:
            continue
        fe = follow_edits(s, sessions, WINDOW)
        if not fe:                       # 후속세션 없으면 관측 불가
            continue
        s["rw_single"] = len(s["single_files"] & fe) / len(s["single_files"])
        s["rw_multi"] = (len(s["multi_files"] & fe) / len(s["multi_files"])) if s["multi_files"] else None
        s["rw_all"] = len(s["edit_files"] & fe) / len(s["edit_files"])
        sample.append(s)

    print(f"전체 n={len(sessions)} · 동질 n={len(homo)} · 검정표본(single≥{MIN_SINGLE}·후속있음) n={len(sample)}\n")
    wc = np.array([s["r_wc"] for s in sample])
    rw_all = np.array([s["rw_all"] for s in sample])
    rw_single = np.array([s["rw_single"] for s in sample])

    print("=== WC 잔차 ↔ rework (구성 중첩 분해) ===")
    print(f"  WC ↔ RW_all    : ρ = {spearman(wc, rw_all):+.2f}  (n={len(sample)})")
    print(f"  WC ↔ RW_single : ρ = {spearman(wc, rw_single):+.2f}  ← 핵심(WC가 만든 파일 제외)")
    multi = [(s["r_wc"], s["rw_multi"]) for s in sample if s["rw_multi"] is not None]
    if len(multi) >= 8:
        mw = np.array([m[0] for m in multi]); mr = np.array([m[1] for m in multi])
        print(f"  WC ↔ RW_multi  : ρ = {spearman(mw, mr):+.2f}  (n={len(multi)}, 중첩 파일)")

    # 부트스트랩: WC ↔ RW_single
    n = len(sample); rng = np.random.RandomState(11); bs = []
    for _ in range(3000):
        idx = rng.randint(0, n, n)
        if len(np.unique(wc[idx])) > 1 and len(np.unique(rw_single[idx])) > 1:
            bs.append(spearman(wc[idx], rw_single[idx]))
    lo, hi = np.percentile(bs, [2.5, 97.5])
    print(f"\n  WC↔RW_single 부트스트랩: 95%CI[{lo:+.2f},{hi:+.2f}]  P(ρ>0)={np.mean(np.array(bs) > 0) * 100:.0f}%")

    # 보조: 편집파일수 통제 부분상관
    nf = size_factor([s["n_edit_files"] for s in sample])
    wc_c = residualize(wc, nf)
    rw_c = residualize(rw_all, nf)
    print(f"\n  [보조] 편집파일수 통제 후 WC↔RW_all: ρ = {spearman(wc_c, rw_c):+.2f}")
    print("\n판정: RW_single이 양이면 WC는 자기가 센 파일 밖에서도 rework 예측 → 중첩 아님(세션 churn 신호).")


if __name__ == "__main__":
    main()
