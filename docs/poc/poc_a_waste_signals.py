#!/usr/bin/env python3
"""
POC-A — Waste-Aware Eval Design / H1 스모크 테스트
==================================================
가설 H1: 결정론적 낭비 신호(W2 컨텍스트, W3 재탐색 등)가 실제 "헛수고"와 상관있는가?

이 스크립트는 LLM을 호출하지 않는다(0 토큰). ~/.claude/projects 의 세션 transcript JSONL을
직접 파싱해 세션별 낭비 신호를 산출하고, 사람이 수기 라벨할 수 있는 시트를 출력한다.

출력:
  1) docs/poc/poc_a_results.csv  — 모든 신호 포함(라벨링 후 대조용)
  2) docs/poc/poc_a_labeling.csv — 신호 숨김(블라인드 라벨링용)
  3) stdout — 분포 통계 + 라벨링 시트

신호 정의(문서 3.2 기반, 단순화):
  - tokens_total       : 세션이 쓴 총 토큰(input+output+cache_creation+cache_read), 메시지 id로 dedup
  - W2_context_waste   : 1 - cache_read_ratio   (cache_read / 전체 input측 토큰). 높을수록 캐시 재사용↓
  - W3_read_redundancy : (Read 호출 - 고유 파일 수) / Read 호출. 동일 파일 반복 read 비율
  - edit_churn         : (Edit/Write 호출 - 고유 편집 파일 수). 같은 파일 반복 편집 횟수
  - turns              : 사용자 프롬프트(턴) 수 — 반복 프록시
  - tool_calls         : 총 도구 호출 수
"""
import json
import os
import glob
import csv
import sys
from collections import defaultdict

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# 분석 대상 선정 기준
MIN_ASSISTANT_MSGS = 4      # 너무 짧은 세션 제외(신호 무의미)
RECENT_N = 40               # 최근 N개 세션만
LABEL_SHEET_N = 15          # 사람이 라벨할 시트 크기


def first_user_prompt(path):
    """세션의 첫 실제 사용자 프롬프트(도구 결과 제외) 추출."""
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
                if e.get("type") != "user":
                    continue
                msg = e.get("message", {})
                content = msg.get("content")
                if isinstance(content, str):
                    s = content.strip()
                    if s and not s.startswith("<"):
                        return s
                elif isinstance(content, list):
                    for b in content:
                        if isinstance(b, dict) and b.get("type") == "text":
                            s = (b.get("text") or "").strip()
                            if s:
                                return s
    except Exception:
        return ""
    return ""


def analyze_session(path):
    usage_by_id = {}          # message.id -> usage dict (dedup)
    model = ""
    read_paths = []
    edit_paths = []
    tool_calls = 0
    turns = 0
    ai_title = ""
    git_branch = ""
    cwd = ""
    ts_first = None
    ts_last = None
    assistant_msgs = 0
    parse_errors = 0

    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    parse_errors += 1
                    continue

                t = e.get("type")
                if e.get("cwd") and not cwd:
                    cwd = e.get("cwd")
                if e.get("gitBranch") and not git_branch:
                    git_branch = e.get("gitBranch")
                ts = e.get("timestamp")
                if ts:
                    if ts_first is None:
                        ts_first = ts
                    ts_last = ts

                if t == "ai-title":
                    ai_title = e.get("aiTitle", "") or ai_title
                elif t == "user":
                    msg = e.get("message", {})
                    content = msg.get("content")
                    # 실제 사용자 턴만 카운트(도구 결과 user 메시지 제외)
                    is_real_prompt = isinstance(content, str) or (
                        isinstance(content, list)
                        and any(isinstance(b, dict) and b.get("type") == "text" for b in content)
                    )
                    if is_real_prompt and not e.get("isSidechain"):
                        turns += 1
                elif t == "assistant":
                    assistant_msgs += 1
                    msg = e.get("message", {})
                    mid = msg.get("id")
                    u = msg.get("usage")
                    if mid and u:
                        usage_by_id[mid] = u  # last wins
                    if msg.get("model"):
                        model = msg.get("model")
                    for b in (msg.get("content") or []):
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "tool_use":
                            tool_calls += 1
                            name = b.get("name")
                            inp = b.get("input") or {}
                            if name == "Read":
                                fp = inp.get("file_path")
                                if fp:
                                    read_paths.append(fp)
                            elif name in ("Edit", "Write", "NotebookEdit"):
                                fp = inp.get("file_path") or inp.get("notebook_path")
                                if fp:
                                    edit_paths.append(fp)
    except Exception:
        return None

    if assistant_msgs < MIN_ASSISTANT_MSGS:
        return None

    inp = out = cc = cr = 0
    for u in usage_by_id.values():
        inp += u.get("input_tokens", 0) or 0
        out += u.get("output_tokens", 0) or 0
        cc += u.get("cache_creation_input_tokens", 0) or 0
        cr += u.get("cache_read_input_tokens", 0) or 0

    input_side = inp + cc + cr
    cache_read_ratio = (cr / input_side) if input_side > 0 else 0.0
    w2 = 1.0 - cache_read_ratio

    reads = len(read_paths)
    unique_reads = len(set(read_paths))
    w3 = ((reads - unique_reads) / reads) if reads > 0 else 0.0

    edits = len(edit_paths)
    unique_edits = len(set(edit_paths))
    edit_churn = edits - unique_edits

    total_tokens = inp + out + cc + cr

    return {
        "session": os.path.basename(path).replace(".jsonl", "")[:8],
        "path": path,
        "project": os.path.basename(os.path.dirname(path)),
        "ai_title": ai_title,
        "git_branch": git_branch,
        "model": model,
        "turns": turns,
        "tool_calls": tool_calls,
        "reads": reads,
        "unique_reads": unique_reads,
        "edits": edits,
        "tokens_total": total_tokens,
        "tokens_input": inp,
        "tokens_output": out,
        "tokens_cache_read": cr,
        "tokens_cache_creation": cc,
        "cache_read_ratio": round(cache_read_ratio, 4),
        "W2_context_waste": round(w2, 4),
        "W3_read_redundancy": round(w3, 4),
        "edit_churn": edit_churn,
        "parse_errors": parse_errors,
        "first_prompt": (first_user_prompt(path) or "")[:120].replace("\n", " "),
        "mtime": os.path.getmtime(path),
    }


def main():
    # 메인 세션 파일만(서브에이전트 디렉토리 제외)
    files = []
    for p in glob.glob(os.path.join(PROJECTS_DIR, "*", "*.jsonl")):
        if os.sep + "subagents" + os.sep in p:
            continue
        files.append(p)
    files.sort(key=os.path.getmtime, reverse=True)

    results = []
    scanned = 0
    for p in files:
        if len(results) >= RECENT_N:
            break
        scanned += 1
        r = analyze_session(p)
        if r:
            results.append(r)

    if not results:
        print("분석 가능한 세션이 없습니다.")
        return

    # 전체 CSV
    cols = ["session", "project", "ai_title", "git_branch", "model", "turns",
            "tool_calls", "reads", "unique_reads", "edits", "tokens_total",
            "tokens_cache_read", "cache_read_ratio", "W2_context_waste",
            "W3_read_redundancy", "edit_churn", "parse_errors", "first_prompt"]
    with open(os.path.join(OUT_DIR, "poc_a_results.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow(r)

    # 라벨링 시트(신호 숨김) — 최근 LABEL_SHEET_N개
    label_rows = results[:LABEL_SHEET_N]
    label_cols = ["idx", "session", "project", "ai_title", "turns", "tool_calls", "first_prompt"]
    with open(os.path.join(OUT_DIR, "poc_a_labeling.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=label_cols + ["label_waste(1=많음,2=보통,3=적음)"])
        w.writeheader()
        for i, r in enumerate(label_rows, 1):
            w.writerow({"idx": i, "session": r["session"], "project": r["project"],
                        "ai_title": r["ai_title"], "turns": r["turns"],
                        "tool_calls": r["tool_calls"], "first_prompt": r["first_prompt"],
                        "label_waste(1=많음,2=보통,3=적음)": ""})

    # ---- stdout 요약 ----
    def stats(key):
        vals = sorted(r[key] for r in results)
        n = len(vals)
        return {
            "min": vals[0], "p25": vals[n // 4], "median": vals[n // 2],
            "p75": vals[(3 * n) // 4], "max": vals[-1],
        }

    print(f"분석 세션: {len(results)}개 (스캔 {scanned}개 / 전체 {len(files)}개 메인 세션)")
    print(f"파싱 에러 라인 합계: {sum(r['parse_errors'] for r in results)}")
    print()
    print("=== 신호 분포 ===")
    for key in ["tokens_total", "W2_context_waste", "W3_read_redundancy", "edit_churn", "cache_read_ratio"]:
        s = stats(key)
        print(f"{key:20s} min={s['min']:>10}  p25={s['p25']:>10}  median={s['median']:>10}  p75={s['p75']:>10}  max={s['max']:>10}")
    print()
    def short_project(p):
        s = p
        for pre in ("-Users-must-hoyoung-Documents-", "-Users-must-hoyoung-Downloads-", "-Users-must-hoyoung-"):
            if s.startswith(pre):
                s = s[len(pre):]
                break
        return s.lstrip("-") or "root"

    print("=== 라벨링 시트 (신호 숨김 / 최근 {}개) — 기억나는 만큼 헛수고 정도를 1=많음/2=보통/3=적음 으로 매겨주세요 ===".format(len(label_rows)))
    print(f"{'#':>2} {'project':28s} {'turns':>5} {'tools':>5}  title / first prompt")
    for i, r in enumerate(label_rows, 1):
        title = r["ai_title"] or r["first_prompt"]
        print(f"{i:>2} {short_project(r['project'])[:28]:28s} {r['turns']:>5} {r['tool_calls']:>5}  {title[:64]}")
    print()
    print("CSV 저장: docs/poc/poc_a_results.csv (전체 신호), docs/poc/poc_a_labeling.csv (라벨링용)")


if __name__ == "__main__":
    main()
