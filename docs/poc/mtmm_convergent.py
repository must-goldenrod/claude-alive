#!/usr/bin/env python3
"""다방법 수렴 분석 (MTMM-lite) + rework 리팩터링 필터 (0토큰).

문헌(Campbell & Fiske 1959): 단일 구성(낭비)을 여러 '방법'으로 재서 수렴 확인.
방법 3종:
  M1 주관   = 사람 라벨(H1)
  M2 객관-세션간 = rework(후속 세션이 같은 파일 재편집)  + 리팩터링 필터 변형
  M3 객관-세션내 = Bash 시행착오(유사 명령 반복)
우리 결정론 축(W2/W3/WC, 크기잔차)이 어느 방법과 수렴하는지 본다.
리팩터링 필터: rework_fix = '직후(≤8h) 작은 후속세션'의 재편집만 → 의도적 리팩터링 배제.
"""
import csv
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
HERE = os.path.dirname(os.path.abspath(__file__))
WINDOW = 259200       # 3일
FIX_WINDOW = 28800    # 8시간(직후 수정)
MIN_TURNS, MIN_ASSIST = 3, 4
_EDIT = {"Edit", "Write", "NotebookEdit"}


def _epoch(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def parse(path):
    usage = {}; edit_paths = []; bash = []
    turns = assist = 0; cwd = ""; ts_first = ts_last = None
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
                        if not isinstance(b, dict) or b.get("type") != "tool_use":
                            continue
                        inp = b.get("input") or {}
                        if b.get("name") in _EDIT:
                            fp = inp.get("file_path") or inp.get("notebook_path")
                            if fp:
                                edit_paths.append(fp)
                        elif b.get("name") == "Bash" and inp.get("command"):
                            bash.append(inp["command"].strip()[:60])  # 정규화(앞 60자)
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
    return {
        "session_id": os.path.basename(path).replace(".jsonl", ""),
        "cwd": cwd, "ts_first": ts_first, "ts_last": ts_last,
        "turns": turns, "assist": assist, "total_tokens": inp + out + cc + cr,
        "w2_raw": max(0, cc - (cc_list[0] if cc_list else 0)),
        "w3_raw": 0,  # (재탐색은 read 필요 — 본 분석선 생략)
        "wc_raw": len(edit_paths) - len(set(edit_paths)),
        "bash_raw": len(bash) - len(set(bash)),     # M3: Bash 반복(시행착오)
        "edit_files": set(edit_paths),
        "n_edit_files": len(set(edit_paths)),
    }


def avg_rank(x):
    x = np.asarray(x, float)
    _, inv, c = np.unique(x, return_inverse=True, return_counts=True)
    o = np.argsort(x, kind="mergesort"); r = np.empty(len(x)); r[o] = np.arange(1, len(x) + 1)
    s = np.zeros(len(c)); np.add.at(s, inv, r); return (s / c)[inv]


def sp_nan(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    m = ~(np.isnan(a) | np.isnan(b))
    if m.sum() < 6:
        return np.nan, int(m.sum())
    return float(np.corrcoef(avg_rank(a[m]), avg_rank(b[m]))[0, 1]), int(m.sum())


def rework(session, pool, window, fix=False):
    ef = session["edit_files"]
    if not ef:
        return np.nan
    fe = set(); med_files = np.median([s["n_edit_files"] for s in pool]) if pool else 0
    for o in pool:
        if o is session or o["cwd"] != session["cwd"]:
            continue
        if session["ts_last"] < o["ts_first"] <= session["ts_last"] + window:
            if fix and o["n_edit_files"] > med_files:    # 큰 후속=리팩터링/계속 → 배제
                continue
            fe |= o["edit_files"]
    return len(ef & fe) / len(ef)


def main():
    files = [p for p in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl"))
             if os.sep + "subagents" + os.sep not in p]
    sessions = [r for p in files if (r := parse(p))]
    homo = [s for s in sessions if s["turns"] >= MIN_TURNS and s["assist"] >= MIN_ASSIST]
    size = size_factor([s["total_tokens"] for s in homo])
    for ax in ["w2_raw", "wc_raw", "bash_raw"]:
        res = residualize([s[ax] for s in homo], size)
        for i, s in enumerate(homo):
            s["r_" + ax] = res[i]
    for s in homo:
        s["rework"] = rework(s, sessions, WINDOW)
        s["rework_fix"] = rework(s, sessions, FIX_WINDOW)   # 직후 8h(리팩터링 배제 근사)
    byid = {s["session_id"][:8]: s for s in homo}

    # 라벨셋 결합
    scores = {int(r["idx"]): r for r in csv.DictReader(open(os.path.join(HERE, "h1b_scores.csv")))}
    labels = {int(r["idx"]): float(r["label"]) for r in csv.DictReader(open(os.path.join(HERE, "h1b_labels.csv")))}
    rows = []
    for i in sorted(labels):
        sid = scores[i]["session"][:8]
        if sid in byid:
            s = byid[sid]
            rows.append({"label": labels[i], "W2": s["r_w2_raw"], "WC": s["r_wc_raw"],
                         "Bash": s["r_bash_raw"], "rework": s["rework"], "rework_fix": s["rework_fix"]})
    n = len(rows)
    print(f"라벨셋 결합 n={n}\n")

    cols = ["label", "W2", "WC", "Bash", "rework", "rework_fix"]
    name = {"label": "M1주관라벨", "W2": "W2잔차", "WC": "WC잔차", "Bash": "M3Bash반복",
            "rework": "M2rework", "rework_fix": "M2rework_fix"}
    data = {c: np.array([r[c] for r in rows], float) for c in cols}

    print("=== 다방법 수렴 상관행렬 (Spearman ρ, 괄호=유효 n) ===")
    print("           " + " ".join(f"{name[c][:9]:>11}" for c in cols))
    for a in cols:
        cells = []
        for b in cols:
            rho, k = sp_nan(data[a], data[b])
            cells.append("    1.00   " if a == b else (f"{rho:+.2f}({k:>2})" if not np.isnan(rho) else "   n/a   "))
        print(f"{name[a][:10]:>10} " + " ".join(f"{c:>11}" for c in cells))

    print("\n=== 핵심 수렴(같은 '낭비'를 다른 방법으로) ===")
    for a, b in [("label", "rework"), ("label", "Bash"), ("rework", "Bash"),
                 ("rework", "rework_fix")]:
        rho, k = sp_nan(data[a], data[b])
        print(f"  {name[a]} ↔ {name[b]}: ρ={rho:+.2f} (n={k})")
    print("\n=== 결정론 축이 어느 방법과 수렴하나 ===")
    for ax in ["W2", "WC", "Bash"]:
        rl, _ = sp_nan(data[ax], data["label"])
        rr, _ = sp_nan(data[ax], data["rework"])
        rf, _ = sp_nan(data[ax], data["rework_fix"])
        print(f"  {name[ax]}: ↔주관 {rl:+.2f} · ↔rework {rr:+.2f} · ↔rework_fix(8h) {rf:+.2f}")

    # 부트스트랩 — 핵심 교차상관 견고성
    print("\n=== 부트스트랩 95%CI (B=3000) ===")
    rng = np.random.RandomState(3)
    for a, b in [("label", "rework"), ("rework", "Bash"), ("label", "Bash")]:
        av, bv = data[a], data[b]
        m = ~(np.isnan(av) | np.isnan(bv)); A, B = av[m], bv[m]; k = len(A)
        bs = []
        for _ in range(3000):
            idx = rng.randint(0, k, k)
            if len(np.unique(A[idx])) > 1 and len(np.unique(B[idx])) > 1:
                bs.append(float(np.corrcoef(avg_rank(A[idx]), avg_rank(B[idx]))[0, 1]))
        lo, hi = np.percentile(bs, [2.5, 97.5])
        rho = float(np.corrcoef(avg_rank(A), avg_rank(B))[0, 1])
        print(f"  {name[a]}↔{name[b]}: ρ={rho:+.2f} CI[{lo:+.2f},{hi:+.2f}] (n={k})")


if __name__ == "__main__":
    main()
