#!/usr/bin/env python3
"""자기점검 #4 — 객관적 낭비 프록시(rework)로 W2 2차 검증 (라벨 없음, 0토큰).

자기평정(H1)은 같은 사람이 세션도 만들고 평가도 해 순환성 위험이 있다. 라벨에
의존하지 않는 *행동 기반* 낭비 신호를 만들어 W2를 독립 검증한다.

rework 정의: 세션 S가 편집한 파일을, 같은 cwd에서 S 종료 직후 WINDOW 내에 시작한
'후속 세션'이 다시 편집하면 → S의 그 파일 작업은 안 붙어 다시 손본 것(rework).
  RW_frac(S) = (후속 세션이 다시 편집한 S의 파일 수) / (S가 편집한 고유 파일 수)
높을수록 "그 세션 산출이 곧 다시 고쳐짐" = 낭비 신호.

검증: 동질 표본에서 W2 잔차 ↔ RW_frac 상관(Spearman). 양의 상관이면 W2가
자기평정과 무관한 객관 낭비도 추적 → 순환성 우회 + 2차 근거.
주의: 후속 편집은 '계획된 다음 단계'일 수도 있어 RW는 rework를 과대推定하는 노이즈 프록시.
"""
import glob
import json
import os
import sys
from datetime import datetime

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from efficio.residual import residualize, size_factor  # noqa: E402

PROJECTS = os.path.expanduser("~/.claude/projects")
WINDOWS = {"1일": 86400, "3일": 259200, "7일": 604800}
MIN_TURNS, MIN_ASSIST, MIN_EDIT_FILES = 3, 4, 3
_EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}


def _epoch(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def parse_full(path):
    usage, edit_files = {}, set()
    reads, edits = [], []
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
                        if not isinstance(b, dict) or b.get("type") != "tool_use":
                            continue
                        inp = b.get("input") or {}
                        if b.get("name") == "Read" and inp.get("file_path"):
                            reads.append(inp["file_path"])
                        elif b.get("name") in _EDIT_TOOLS:
                            fp = inp.get("file_path") or inp.get("notebook_path")
                            if fp:
                                edits.append(fp); edit_files.add(fp)
    except OSError:
        return None
    if ts_first is None:
        return None
    cc = cr = inp = out = 0; cc_list = []
    for u in usage.values():
        inp += u.get("input_tokens", 0) or 0
        out += u.get("output_tokens", 0) or 0
        c = u.get("cache_creation_input_tokens", 0) or 0
        cc += c; cc_list.append(c)
        cr += u.get("cache_read_input_tokens", 0) or 0
    return {
        "session_id": os.path.basename(path).replace(".jsonl", ""),
        "cwd": cwd, "ts_first": ts_first, "ts_last": ts_last,
        "turns": turns, "assist": assist,
        "total_tokens": inp + out + cc + cr,
        "w2_raw": max(0, cc - (cc_list[0] if cc_list else 0)),
        "w3_raw": len(reads) - len(set(reads)),
        "wc_raw": len(edits) - len(set(edits)),
        "edit_files": edit_files,
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


def rework_frac(session, all_sessions, window):
    """세션이 편집한 파일 중, 같은 cwd·종료 후 window 내 시작 후속세션이 다시 편집한 비율."""
    ef = session["edit_files"]
    if not ef:
        return None, 0
    follow_edits = set()
    n_follow = 0
    for other in all_sessions:
        if other is session or other["cwd"] != session["cwd"]:
            continue
        if session["ts_last"] < other["ts_first"] <= session["ts_last"] + window:
            n_follow += 1
            follow_edits |= other["edit_files"]
    reworked = ef & follow_edits
    return len(reworked) / len(ef), n_follow


def main():
    files = [p for p in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl"))
             if os.sep + "subagents" + os.sep not in p]
    sessions = [r for p in files if (r := parse_full(p))]
    print(f"전체 파싱 세션 n={len(sessions)} (후속 매칭 풀)")

    homo = [s for s in sessions if s["turns"] >= MIN_TURNS and s["assist"] >= MIN_ASSIST]
    size = size_factor([s["total_tokens"] for s in homo])
    r_w2 = residualize([s["w2_raw"] for s in homo], size)
    r_w3 = residualize([s["w3_raw"] for s in homo], size)
    r_wc = residualize([s["wc_raw"] for s in homo], size)
    for i, s in enumerate(homo):
        s["r_w2"], s["r_w3"], s["r_wc"] = r_w2[i], r_w3[i], r_wc[i]

    print(f"동질 표본(turns>=3,assist>=4) n={len(homo)}\n")
    for wname, wsec in WINDOWS.items():
        sample = []
        for s in homo:
            if len(s["edit_files"]) < MIN_EDIT_FILES:
                continue
            rw, n_follow = rework_frac(s, sessions, wsec)
            if rw is None or n_follow == 0:    # 후속세션 없으면 관측 불가 → 제외
                continue
            s2 = dict(s); s2["rw"] = rw
            sample.append(s2)
        if len(sample) < 8:
            print(f"[{wname}] 표본 {len(sample)}개 — 부족, 생략")
            continue
        rw = np.array([s["rw"] for s in sample])
        print(f"[{wname}] 표본 n={len(sample)} (편집≥{MIN_EDIT_FILES}파일·후속세션 있음) · "
              f"RW 평균={rw.mean():.2f} median={np.median(rw):.2f}")
        for key, name in [("r_w2", "W2 잔차"), ("r_w3", "W3 잔차"), ("r_wc", "WC 잔차")]:
            v = np.array([s[key] for s in sample])
            print(f"      {name} ↔ rework(RW): ρ = {spearman(v, rw):+.2f}")
        # 참고: raw 크기와 RW
        tok = np.array([s["total_tokens"] for s in sample])
        print(f"      (참고) raw tokens ↔ RW: ρ = {spearman(tok, rw):+.2f}")
    print("\n해석: W2 잔차 ↔ RW가 양이면, 자기평정과 무관한 객관 낭비도 W2가 추적(순환성 우회).")


if __name__ == "__main__":
    main()
