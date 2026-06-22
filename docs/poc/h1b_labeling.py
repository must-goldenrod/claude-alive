#!/usr/bin/env python3
"""
H1 라운드2 — 강화된 기준타당도 (n≈30, 정렬된 라벨)
=================================================
라운드1(n=16, 러프, 1=많음..3=적음)이 FAIL/저검정력이었다. 라운드2는:
  - 표본 n≈30으로 확대
  - 척도 뒤집음: 1=매끄러움(헛수고 거의 없음) .. 5=헛수고 많음 (높을수록 낭비)
  - 라벨 기준을 지표와 정렬: "결과/방향 무시. 같은 결과를 더 적은 왕복으로 낼 수 있었나"

Phase1: 점수 숨긴 블라인드 시트 출력 + h1b_scores.csv 저장
Phase2: h1b_labels.csv(idx,label) 있으면 상관(높은 label vs 높은 잔차 → +ρ 기대, 임계 +0.5)
"""
import json, os, glob, csv
import numpy as np

PROJECTS = os.path.expanduser("~/.claude/projects")
HERE = os.path.dirname(os.path.abspath(__file__))
SCAN, RECENT_POOL, LABEL_N = 400, 70, 30
MIN_TURNS, MIN_ASSIST, TH = 3, 4, 0.50


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
                    m = e.get("message", {}); c = m.get("content"); txt = None
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
                                first_prompt = s[:90].replace("\n", " ")
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
    return {"session": os.path.basename(path).replace(".jsonl", "")[:8],
            "project": os.path.basename(os.path.dirname(path)),
            "ai_title": ai_title, "first_prompt": first_prompt,
            "turns": turns, "tools": len(reads) + len(edits),
            "total_tokens": inp + out + cc + cr,
            "W2_raw": max(0, cc - (cc_list[0] if cc_list else 0)),
            "W3_raw": len(reads) - len(set(reads)),
            "WC_raw": len(edits) - len(set(edits)),
            "mtime": os.path.getmtime(path)}


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


def short(p):
    for pre in ("-Users-must-hoyoung-Documents-", "-Users-must-hoyoung-Downloads-", "-Users-must-hoyoung-"):
        if p.startswith(pre):
            return p[len(pre):].lstrip("-")
    return p


def main():
    files = [p for p in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl"))
             if os.sep + "subagents" + os.sep not in p]
    files.sort(key=os.path.getmtime, reverse=True)
    sess = [r for p in files[:SCAN] if (r := parse(p))]
    print(f"개발세션 표본 n={len(sess)}")
    size = np.log(np.array([s["total_tokens"] for s in sess], float) + 1)
    res = {ax: residualize(np.array([s[ax] for s in sess], float), size)
           for ax in ["W2_raw", "W3_raw", "WC_raw"]}
    comp = np.mean([avg_rank(res[ax]) for ax in res], axis=0)
    for i, s in enumerate(sess):
        s["r_W2"], s["r_W3"], s["r_WC"], s["composite"] = res["W2_raw"][i], res["W3_raw"][i], res["WC_raw"][i], comp[i]

    pool = sorted(sess, key=lambda s: s["mtime"], reverse=True)[:RECENT_POOL]
    pool.sort(key=lambda s: s["composite"])
    idxs = np.linspace(0, len(pool) - 1, LABEL_N).round().astype(int)
    picked = [pool[i] for i in sorted(set(idxs))]

    with open(os.path.join(HERE, "h1b_scores.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["idx", "session", "project", "ai_title", "turns", "tools", "tokens",
                    "r_W2", "r_W3", "r_WC", "composite"])
        for i, s in enumerate(picked, 1):
            w.writerow([i, s["session"], short(s["project"]), s["ai_title"], s["turns"], s["tools"],
                        int(s["total_tokens"]), round(s["r_W2"], 1), round(s["r_W3"], 2),
                        round(s["r_WC"], 2), round(s["composite"], 1)])

    lp = os.path.join(HERE, "h1b_labels.csv")
    if os.path.exists(lp):
        lab = {}
        with open(lp) as f:
            for row in csv.DictReader(f):
                try:
                    lab[int(row["idx"])] = float(row["label"])
                except Exception:
                    pass
        rows = [i for i, s in enumerate(picked, 1) if i in lab]
        if len(rows) < 8:
            print(f"라벨 {len(rows)}개 — 8개 미만이면 검정력 부족."); return
        waste = np.array([lab[i] for i in rows], float)  # 1=매끄러움..5=많음 (높을수록 낭비)
        print(f"\n=== H1 라운드2 상관 (라벨 {len(rows)}개, 1=매끄러움..5=헛수고많음) ===")
        idx2s = {i: s for i, s in enumerate(picked, 1)}
        for key, name in [("composite", "합성 잔차점수"), ("r_W2", "잔차 W2"),
                          ("r_W3", "잔차 W3"), ("r_WC", "잔차 WC")]:
            v = np.array([idx2s[i][key] for i in rows], float)
            rho = spearman(waste, v)
            print(f"  {name:14s}: ρ = {rho:+.2f}   {'PASS(≥0.5)' if rho >= TH else 'FAIL'}")
        tok = np.array([idx2s[i]["total_tokens"] for i in rows], float)
        trn = np.array([idx2s[i]["turns"] for i in rows], float)
        print(f"\n  [참고] 라벨 vs raw 크기 — tokens ρ={spearman(waste, tok):+.2f}  turns ρ={spearman(waste, trn):+.2f}")
    else:
        print("\n=== H1 라운드2 블라인드 라벨링 시트 (점수 숨김) ===")
        print("기준: 결과/방향이 좋았는지는 무시. '같은 결과를 더 적은 왕복으로 낼 수 있었나'만.")
        print("1=거의 한 번에 매끄러움 · 3=보통 · 5=같은 걸 여러 번 다시/헤맴 많음. 기억 안 나면 skip.")
        print(f"{'#':>2} {'project':20s} {'turns':>5} {'tools':>5}  title / prompt")
        for i, s in enumerate(picked, 1):
            t = s["ai_title"] or s["first_prompt"]
            print(f"{i:>2} {short(s['project'])[:20]:20s} {s['turns']:>5} {s['tools']:>5}  {t[:52]}")
        print("\n저장: h1b_scores.csv · 라벨 후 h1b_labels.csv(idx,label) 만들고 재실행")


if __name__ == "__main__":
    main()
