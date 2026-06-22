#!/usr/bin/env python3
"""
H1 기준타당도 (Criterion Validity) — 잔차 신호 vs 사람 라벨
==========================================================
Pilot-0는 잔차축이 "크기가 아님"(구성타당도)을 보였다. H1은 그 잔차가 "실제 헛수고임"을
사람 라벨과 대조해 확인한다(기준타당도). 합격 임계: Spearman |ρ| ≥ 0.5.

Phase 1 (라벨 없음): 잔차 W2/W3/WC + 합성점수를 산출하고, 점수를 숨긴 블라인드
                     라벨링 시트를 출력. 전체 점수는 h1_scores.csv에 저장.
Phase 2 (h1_labels.csv 존재 시): 라벨(idx,label 1=많음/2=보통/3=적음)을 읽어
                     라벨 vs 잔차 상관을 계산.

라벨링 세션 선정: 최근 개발세션(turns>=3) 중 합성 잔차점수를 고르게 가르도록 N개 선택
                  (최근성=기억 용이 + 점수 범위 spread 양쪽 확보).
"""
import json
import os
import glob
import csv
import numpy as np

PROJECTS = os.path.expanduser("~/.claude/projects")
HERE = os.path.dirname(os.path.abspath(__file__))
SCAN = 400
RECENT_POOL = 45     # 최근 개발세션 풀(여기서 라벨 대상 선정)
LABEL_N = 16         # 라벨링 시트 크기
MIN_TURNS, MIN_ASSIST = 3, 4
TH = 0.50


def parse(path):
    usage, reads, edits = {}, [], []
    turns = assist = 0
    ai_title = first_prompt = cwd = ""
    try:
        with open(path, encoding="utf-8") as f:
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
                t = e.get("type")
                if t == "ai-title":
                    ai_title = e.get("aiTitle", "") or ai_title
                elif t == "user":
                    m = e.get("message", {}); c = m.get("content")
                    txt = None
                    if isinstance(c, str):
                        txt = c
                    elif isinstance(c, list):
                        for b in c:
                            if isinstance(b, dict) and b.get("type") == "text":
                                txt = b.get("text"); break
                    if txt and not e.get("isSidechain"):
                        s = txt.strip()
                        if s and not s.startswith("<"):
                            turns += 1
                            if not first_prompt:
                                first_prompt = s[:110].replace("\n", " ")
                elif t == "assistant":
                    assist += 1
                    m = e.get("message", {}); mid, u = m.get("id"), m.get("usage")
                    if mid and u:
                        usage[mid] = u
                    for b in (m.get("content") or []):
                        if isinstance(b, dict) and b.get("type") == "tool_use":
                            inp = b.get("input") or {}
                            if b.get("name") == "Read" and inp.get("file_path"):
                                reads.append(inp["file_path"])
                            elif b.get("name") in ("Edit", "Write", "NotebookEdit"):
                                fp = inp.get("file_path") or inp.get("notebook_path")
                                if fp:
                                    edits.append(fp)
    except Exception:
        return None
    if assist < MIN_ASSIST or turns < MIN_TURNS:
        return None
    cc = cr = inp = out = 0; cc_list = []
    for u in usage.values():
        inp += u.get("input_tokens", 0) or 0
        out += u.get("output_tokens", 0) or 0
        c = u.get("cache_creation_input_tokens", 0) or 0
        cc += c; cc_list.append(c)
        cr += u.get("cache_read_input_tokens", 0) or 0
    return {
        "session": os.path.basename(path).replace(".jsonl", "")[:8],
        "project": os.path.basename(os.path.dirname(path)),
        "ai_title": ai_title, "first_prompt": first_prompt,
        "turns": turns, "tool_calls": len(reads) + len(edits),
        "total_tokens": inp + out + cc + cr,
        "W2_raw": max(0, cc - (cc_list[0] if cc_list else 0)),
        "W3_raw": len(reads) - len(set(reads)),
        "WC_raw": len(edits) - len(set(edits)),
        "mtime": os.path.getmtime(path),
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


def theil_sen(x, y):
    x = np.asarray(x, float); y = np.asarray(y, float); sl = []
    for i in range(len(x)):
        dx = x[i + 1:] - x[i]; dy = y[i + 1:] - y[i]; m = dx != 0
        sl.extend((dy[m] / dx[m]).tolist())
    b = float(np.median(sl)) if sl else 0.0
    return float(np.median(y - b * x)), b


def residualize(y, size):
    a, b = theil_sen(size, y)
    return np.asarray(y, float) - (a + b * np.asarray(size, float))


def short_proj(p):
    for pre in ("-Users-must-hoyoung-Documents-", "-Users-must-hoyoung-Downloads-", "-Users-must-hoyoung-"):
        if p.startswith(pre):
            return p[len(pre):].lstrip("-")
    return p


def main():
    files = [p for p in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl"))
             if os.sep + "subagents" + os.sep not in p]
    files.sort(key=os.path.getmtime, reverse=True)
    sess = []
    for p in files[:SCAN]:
        r = parse(p)
        if r:
            sess.append(r)
    n = len(sess)
    print(f"개발세션 표본 n={n}")

    size = np.log(np.array([s["total_tokens"] for s in sess], float) + 1)
    res = {}
    for ax in ["W2_raw", "W3_raw", "WC_raw"]:
        res[ax] = residualize(np.array([s[ax] for s in sess], float), size)
    # 합성 잔차점수 = 세 축 잔차의 순위 평균(클수록 낭비 의심)
    comp = np.mean([avg_rank(res[ax]) for ax in res], axis=0)
    for i, s in enumerate(sess):
        s["r_W2"], s["r_W3"], s["r_WC"] = res["W2_raw"][i], res["W3_raw"][i], res["WC_raw"][i]
        s["composite"] = comp[i]

    # 라벨 대상 선정: 최근 풀에서 합성점수 고르게
    pool = sorted(sess, key=lambda s: s["mtime"], reverse=True)[:RECENT_POOL]
    pool.sort(key=lambda s: s["composite"])
    idxs = np.linspace(0, len(pool) - 1, LABEL_N).round().astype(int)
    picked = [pool[i] for i in sorted(set(idxs))]

    # 전체 점수 저장(숨김)
    with open(os.path.join(HERE, "h1_scores.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["idx", "session", "project", "ai_title", "turns", "tokens",
                    "r_W2", "r_W3", "r_WC", "composite"])
        for i, s in enumerate(picked, 1):
            w.writerow([i, s["session"], short_proj(s["project"]), s["ai_title"],
                        s["turns"], int(s["total_tokens"]),
                        round(s["r_W2"], 1), round(s["r_W3"], 2), round(s["r_WC"], 2),
                        round(s["composite"], 1)])

    labels_path = os.path.join(HERE, "h1_labels.csv")
    if os.path.exists(labels_path):
        lab = {}
        with open(labels_path) as f:
            for row in csv.DictReader(f):
                try:
                    lab[int(row["idx"])] = int(row["label"])
                except Exception:
                    pass
        rows = [(i, s) for i, s in enumerate(picked, 1) if i in lab]
        if len(rows) < 5:
            print("라벨 5개 미만 — 상관 생략."); return
        y = np.array([lab[i] for i, _ in rows], float)        # 1=많음..3=적음
        waste = 4 - y                                          # 3=많음..1=적음 (높을수록 낭비)
        print(f"\n=== H1 상관분석 (라벨 {len(rows)}개) — label 1=많음/2=보통/3=적음 ===")
        print("  (waste = 4-label, 높을수록 헛수고 많음 / 잔차도 높을수록 낭비 의심)")
        for key, name in [("composite", "합성 잔차점수"), ("r_W2", "잔차 W2"),
                          ("r_W3", "잔차 W3"), ("r_WC", "잔차 WC")]:
            v = np.array([s[key] for _, s in rows], float)
            rho = spearman(waste, v)
            print(f"  {name:14s} vs 사람 라벨: ρ = {rho:+.2f}  "
                  f"{'PASS(≥0.5)' if rho >= TH else 'FAIL'}")
    else:
        print("\n=== H1 블라인드 라벨링 시트 (점수 숨김) ===")
        print("기억나는 세션에 헛수고 정도를 1=많음 / 2=보통 / 3=적음 으로 매겨주세요.")
        print(f"{'#':>2} {'project':22s} {'turns':>5}  title / first prompt")
        for i, s in enumerate(picked, 1):
            title = s["ai_title"] or s["first_prompt"]
            print(f"{i:>2} {short_proj(s['project'])[:22]:22s} {s['turns']:>5}  {title[:60]}")
        print("\n점수 저장: h1_scores.csv  ·  라벨 입력 후 h1_labels.csv(idx,label) 만들고 재실행")


if __name__ == "__main__":
    main()
