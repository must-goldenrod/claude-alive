"""Deterministic per-session signal extraction from Claude Code transcript JSONL.

0 토큰. LLM 호출 없이 로컬 transcript에서 원시 신호만 뽑는다.
검증 근거: docs/waste-aware-eval-design.md 13장(Pilot-0, H1). M0 범위는 단일 세션.
"""
from __future__ import annotations

import json
import os

# M0 검증 범위(Pilot-0/H1이 성립한 균질 개발세션). 이보다 짧은 세션은 신호가 비어 제외.
MIN_TURNS = 3
MIN_ASSISTANT = 4

_EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}


def extract_session(path: str) -> dict | None:
    """Transcript JSONL 한 개 → 원시 신호 레코드. 범위 미달/파싱 실패 시 None.

    반환 키: session_id, project, cwd, git_branch, ts_first, ts_last, turns,
    tool_calls, reads, edits, assistant_msgs, input/output/cache_* tokens,
    total_tokens, w2_raw, w3_raw, wc_raw, ai_title.
    """
    usage: dict[str, dict] = {}      # message.id -> usage (insertion order = chronological)
    read_paths: list[str] = []
    edit_paths: list[str] = []
    turns = assistant_msgs = tool_calls = 0
    cwd = git_branch = ai_title = ""
    ts_first = ts_last = None

    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except (ValueError, json.JSONDecodeError):
                    continue  # 비공식 포맷 방어 (R4)

                if entry.get("cwd") and not cwd:
                    cwd = entry["cwd"]
                if entry.get("gitBranch") and not git_branch:
                    git_branch = entry["gitBranch"]
                ts = entry.get("timestamp")
                if ts:
                    if ts_first is None:
                        ts_first = ts
                    ts_last = ts

                etype = entry.get("type")
                if etype == "ai-title":
                    ai_title = entry.get("aiTitle", "") or ai_title
                elif etype == "user":
                    if _is_real_prompt(entry):
                        turns += 1
                elif etype == "assistant":
                    assistant_msgs += 1
                    tool_calls += _collect_assistant(entry, usage, read_paths, edit_paths)
    except OSError:
        return None

    if assistant_msgs < MIN_ASSISTANT or turns < MIN_TURNS:
        return None

    tokens = _sum_tokens(usage)
    return {
        "session_id": os.path.basename(path).replace(".jsonl", ""),
        "project": os.path.basename(os.path.dirname(path)),
        "cwd": cwd,
        "git_branch": git_branch,
        "ai_title": ai_title,
        "ts_first": _epoch(ts_first),
        "ts_last": _epoch(ts_last),
        "turns": turns,
        "assistant_msgs": assistant_msgs,
        "tool_calls": tool_calls,
        "reads": len(read_paths),
        "edits": len(edit_paths),
        **tokens,
        "w2_raw": max(0, tokens["cache_creation"] - tokens["_first_cache_creation"]),
        "w3_raw": len(read_paths) - len(set(read_paths)),
        "wc_raw": len(edit_paths) - len(set(edit_paths)),
    }


def _is_real_prompt(entry: dict) -> bool:
    """도구 결과 user 메시지가 아닌 실제 사용자 턴인가."""
    if entry.get("isSidechain"):
        return False
    content = entry.get("message", {}).get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        return any(isinstance(b, dict) and b.get("type") == "text" for b in content)
    return False


def _collect_assistant(entry, usage, read_paths, edit_paths) -> int:
    """assistant 메시지에서 usage/도구호출 수집. 반환: tool_use 수."""
    msg = entry.get("message", {})
    mid, u = msg.get("id"), msg.get("usage")
    if mid and u:
        usage[mid] = u  # 같은 id 반복 블록은 last-wins로 dedup
    tool_uses = 0
    for block in (msg.get("content") or []):
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        tool_uses += 1
        name = block.get("name")
        inp = block.get("input") or {}
        if name == "Read" and inp.get("file_path"):
            read_paths.append(inp["file_path"])
        elif name in _EDIT_TOOLS:
            fp = inp.get("file_path") or inp.get("notebook_path")
            if fp:
                edit_paths.append(fp)
    return tool_uses


def _sum_tokens(usage: dict) -> dict:
    inp = out = cc = cr = 0
    first_cc = None
    for u in usage.values():
        inp += u.get("input_tokens", 0) or 0
        out += u.get("output_tokens", 0) or 0
        c = u.get("cache_creation_input_tokens", 0) or 0
        cc += c
        if first_cc is None:
            first_cc = c
        cr += u.get("cache_read_input_tokens", 0) or 0
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_creation": cc,
        "cache_read": cr,
        "total_tokens": inp + out + cc + cr,
        "_first_cache_creation": first_cc or 0,  # 워밍업(회피불가) 제외용
    }


def _epoch(ts: str | None) -> float | None:
    if not ts:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def iter_sessions(projects_dir: str):
    """~/.claude/projects 하위 메인 세션(서브에이전트 제외) transcript 경로 yield."""
    import glob
    for path in glob.glob(os.path.join(projects_dir, "*", "*.jsonl")):
        if os.sep + "subagents" + os.sep in path:
            continue
        yield path
