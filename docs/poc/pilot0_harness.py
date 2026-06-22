#!/usr/bin/env python3
"""
Pilot-0 하니스 — M0 전제 실측 (0 토큰)
=====================================
기획서 v0.2.1의 M0 게이트. 세 가지를 실측해 잠정 임계와 대조하고 M0 가부를 판정한다.

(a) attribution 오귀속률   : cwd+시간창으로 커밋↔세션 매칭 시 충돌(2+ 세션 동시) 비율
(b) 잔차화 신호 밀도        : W2재무효화/W3재탐색/WC편집반복을 크기잔차+허들로 재계산, 비-0 WU 비율
(c) 구성타당도 재현         : 균질·대형 표본에서 PC1 분산설명, 잔차화 후 크기상관

잠정 임계(기획서):
  - 오귀속률 ≤ 10%        → 초과면 단계2(PR 단위 WU) 보류
  - 비-0 WU ≥ 30% (축별)  → 미달 축은 M0 단계1 핵심에서 제외
  - PC1 분산설명 ≤ 50%     → 초과면 무료 축이 크기 대리지표(잔차화 필수 확인)
  - 잔차화 후 |ρ(size)|<0.3 → 잔차가 크기 독립인지

표본: 균질화를 위해 turns>=3 (반복형 개발 세션), assistant_msgs>=4. 1턴 리뷰 제외.
"""
import json
import os
import glob
import subprocess
from datetime import datetime
import numpy as np

PROJECTS = os.path.expanduser("~/.claude/projects")
SCAN_LIMIT = 400          # 최근 N개 메인 세션 스캔
MIN_TURNS = 3
MIN_ASSIST = 4

TH_MISATTR = 0.10
TH_DENSITY = 0.30
TH_PC1 = 0.50
TH_RESID_RHO = 0.30


def iso_epoch(s):
    if not s:
        return None
    try:
        s = s.replace("Z", "+00:00")
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def parse_session(path):
    usage = {}           # msg_id -> usage (insertion order = chrono)
    read_paths, edit_paths = [], []
    tool_calls = 0
    turns = 0
    assist = 0
    cwd = ""
    ts_first = ts_last = None
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                if e.get("cwd") and not cwd:
                    cwd = e["cwd"]
                ep = iso_epoch(e.get("timestamp"))
                if ep:
                    if ts_first is None:
                        ts_first = ep
                    ts_last = ep
                t = e.get("type")
                if t == "user":
                    m = e.get("message", {})
                    c = m.get("content")
                    real = isinstance(c, str) or (isinstance(c, list) and any(
                        isinstance(b, dict) and b.get("type") == "text" for b in c))
                    if real and not e.get("isSidechain"):
                        turns += 1
                elif t == "assistant":
                    assist += 1
                    m = e.get("message", {})
                    mid, u = m.get("id"), m.get("usage")
                    if mid and u:
                        usage[mid] = u
                    for b in (m.get("content") or []):
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "tool_use":
                            tool_calls += 1
                            inp = b.get("input") or {}
                            if b.get("name") == "Read":
                                if inp.get("file_path"):
                                    read_paths.append(inp["file_path"])
                            elif b.get("name") in ("Edit", "Write", "NotebookEdit"):
                                fp = inp.get("file_path") or inp.get("notebook_path")
                                if fp:
                                    edit_paths.append(fp)
    except Exception:
        return None
    if assist < MIN_ASSIST or turns < MIN_TURNS:
        return None

    inp = out = cc = cr = 0
    cc_list = []
    for u in usage.values():
        inp += u.get("input_tokens", 0) or 0
        out += u.get("output_tokens", 0) or 0
        c = u.get("cache_creation_input_tokens", 0) or 0
        cc += c
        cc_list.append(c)
        cr += u.get("cache_read_input_tokens", 0) or 0
    total = inp + out + cc + cr
    w2_raw = max(0, cc - (cc_list[0] if cc_list else 0))      # 워밍업 제외
    w3_raw = len(read_paths) - len(set(read_paths))
    wc_raw = len(edit_paths) - len(set(edit_paths))
    return {
        "path": path, "cwd": cwd, "ts_first": ts_first, "ts_last": ts_last,
        "project": os.path.basename(os.path.dirname(path)),
        "turns": turns, "tool_calls": tool_calls, "reads": len(read_paths),
        "edits": len(edit_paths), "total_tokens": total,
        "W2_raw": w2_raw, "W3_raw": w3_raw, "WC_raw": wc_raw,
    }


# ---------- 통계 유틸 ----------
def avg_rank(x):
    x = np.asarray(x, float)
    _, inv, counts = np.unique(x, return_inverse=True, return_counts=True)
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(len(x)); ranks[order] = np.arange(1, len(x) + 1)
    sums = np.zeros(len(counts)); np.add.at(sums, inv, ranks)
    return (sums / counts)[inv]


def spearman(a, b):
    ra, rb = avg_rank(a), avg_rank(b)
    return float(np.corrcoef(ra, rb)[0, 1])


def theil_sen(x, y):
    x = np.asarray(x, float); y = np.asarray(y, float)
    n = len(x); slopes = []
    for i in range(n):
        dx = x[i + 1:] - x[i]
        dy = y[i + 1:] - y[i]
        m = dx != 0
        slopes.extend((dy[m] / dx[m]).tolist())
    if not slopes:
        return 0.0, float(np.median(y))
    b = float(np.median(slopes))
    a = float(np.median(y - b * x))
    return a, b


def residualize(y, size):
    a, b = theil_sen(size, y)
    return np.asarray(y, float) - (a + b * np.asarray(size, float))


def pca_pc1(data, cols):
    X = np.column_stack([data[c] for c in cols]).astype(float)
    sd = X.std(axis=0, ddof=1); sd[sd == 0] = 1
    Z = (X - X.mean(axis=0)) / sd
    ev = np.linalg.eigvalsh(np.cov(Z, rowvar=False))
    ev = np.sort(ev)[::-1]
    return ev / ev.sum()


# ---------- attribution ----------
def git_commit_times(cwd):
    try:
        r = subprocess.run(["git", "-C", cwd, "log", "--all", "--pretty=%ct"],
                           capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return None
        return [int(x) for x in r.stdout.split() if x.strip().isdigit()]
    except Exception:
        return None


def attribution_analysis(sessions):
    by_cwd = {}
    for s in sessions:
        if s["cwd"] and s["ts_first"] and s["ts_last"]:
            by_cwd.setdefault(s["cwd"], []).append(s)
    covered = collision = total_commits = 0
    repos = 0
    for cwd, sess in by_cwd.items():
        times = git_commit_times(cwd)
        if times is None:
            continue
        repos += 1
        # 세션 윈도우와 겹치는 최근 90일 커밋만(오래된 커밋은 세션 이전)
        wins = [(s["ts_first"], s["ts_last"]) for s in sess]
        tmin = min(w[0] for w in wins)
        for tc in times:
            if tc < tmin:
                continue
            total_commits += 1
            k = sum(1 for (a, b) in wins if a <= tc <= b)
            if k >= 1:
                covered += 1
            if k >= 2:
                collision += 1
    cov_rate = covered / total_commits if total_commits else 0.0
    mis_rate = collision / covered if covered else 0.0
    return {"repos": repos, "total_commits": total_commits, "covered": covered,
            "collision": collision, "coverage_rate": cov_rate, "misattr_rate": mis_rate}


def main():
    files = [p for p in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl"))
             if os.sep + "subagents" + os.sep not in p]
    files.sort(key=os.path.getmtime, reverse=True)

    sessions = []
    scanned = 0
    for p in files[:SCAN_LIMIT]:
        scanned += 1
        r = parse_session(p)
        if r:
            sessions.append(r)

    n = len(sessions)
    print(f"스캔 {scanned}개 → 균질 표본(turns>=3, assist>=4): n={n}\n")
    if n < 10:
        print("표본 부족.")
        return

    # 표본 구성
    from collections import Counter
    proj = Counter(s["project"] for s in sessions)
    print("표본 프로젝트 분포(top):", dict(proj.most_common(6)))
    turns = np.array([s["turns"] for s in sessions])
    print(f"turns 분포: min={turns.min()} median={int(np.median(turns))} max={turns.max()}\n")

    data = {k: np.array([s[k] for s in sessions], float)
            for k in ["total_tokens", "tool_calls", "reads", "edits", "W2_raw", "W3_raw", "WC_raw"]}
    size = np.log(data["total_tokens"] + 1)

    # ===== (a) attribution =====
    print("=" * 64)
    print("(a) ATTRIBUTION 오귀속률")
    att = attribution_analysis(sessions)
    print(f"  git 레포 {att['repos']}개 · 세션창 이후 커밋 {att['total_commits']}개")
    print(f"  커버리지(세션창에 들어온 커밋): {att['coverage_rate']*100:.1f}% ({att['covered']}/{att['total_commits']})")
    print(f"  충돌(2+ 세션 동시): {att['collision']}개")
    print(f"  >> 오귀속률 = {att['misattr_rate']*100:.1f}%  (임계 ≤{TH_MISATTR*100:.0f}%)  "
          f"{'PASS' if att['misattr_rate']<=TH_MISATTR else 'FAIL→단계2 보류'}")
    print()

    # ===== (b) 신호 밀도 =====
    print("=" * 64)
    print("(b) 잔차화 신호 밀도 (비-0 WU 비율)")
    density = {}
    for ax in ["W2_raw", "W3_raw", "WC_raw"]:
        nz = float(np.mean(data[ax] > 0))
        density[ax] = nz
        print(f"  {ax:8s}: 비-0 비율 = {nz*100:5.1f}%  (임계 ≥{TH_DENSITY*100:.0f}%)  "
              f"{'PASS' if nz>=TH_DENSITY else 'FAIL→축 제외'}")
    print()

    # ===== (c) 구성타당도 =====
    print("=" * 64)
    print("(c) 구성타당도 재현")
    cols = ["total_tokens", "tool_calls", "reads", "edits", "W2_raw", "W3_raw", "WC_raw"]
    ve = pca_pc1(data, cols)
    print(f"  표준화 {len(cols)}변수 PCA: PC1={ve[0]*100:.1f}%  PC2={ve[1]*100:.1f}%  "
          f"(임계 PC1 ≤{TH_PC1*100:.0f}%)  {'PASS' if ve[0]<=TH_PC1 else 'FAIL→크기 대리지표'}")
    print()
    print("  원시 신호 × 크기 상관 (Spearman ρ) → 잔차화 후:")
    print(f"  {'축':8s} {'raw ρ(size)':>12s} {'잔차 ρ(size)':>13s} {'보존량(var)':>12s}")
    for ax in ["W2_raw", "W3_raw", "WC_raw"]:
        raw_rho = spearman(data[ax], size)
        resid = residualize(data[ax], size)
        res_rho = spearman(resid, size)
        retention = float(np.var(resid) / np.var(data[ax])) if np.var(data[ax]) > 0 else 0.0
        flag = "PASS" if abs(res_rho) < TH_RESID_RHO else "FAIL"
        print(f"  {ax:8s} {raw_rho:>12.2f} {res_rho:>13.2f} {retention:>12.2f}  {flag}")
    print()

    # ===== 종합 판정 =====
    print("=" * 64)
    print("M0 가부 판정 (잠정 임계 대조)")
    axes_pass = [ax for ax in ["W2_raw", "W3_raw", "WC_raw"] if density[ax] >= TH_DENSITY]
    print(f"  · attribution: {'단계2 가능' if att['misattr_rate']<=TH_MISATTR else '단계2 보류(단일세션만)'}")
    print(f"  · M0 채택 가능 단계1 축: {len(axes_pass)}개 {axes_pass}")
    print(f"  · 구성타당도: PC1={ve[0]*100:.1f}% → {'잔차화로 크기분리 가능' if ve[0]>TH_PC1 else '크기지배 약함'}")
    if len(axes_pass) == 0:
        print("  >> M0 보류: 신호밀도 임계 통과 축 0개 → 신규 결정론 신호 탐색 필요(3장 미해결)")
    else:
        print(f"  >> M0 진행 가능: {len(axes_pass)}개 축으로 단일세션 프로파일 구성")


if __name__ == "__main__":
    main()
