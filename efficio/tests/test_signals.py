import json
import os
import tempfile
import unittest

from efficio import signals


def _write_jsonl(lines):
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        for obj in lines:
            fh.write(json.dumps(obj) + "\n")
    return path


def _assistant(mid, cache_creation, tool=None, fp=None):
    content = []
    if tool:
        content.append({"type": "tool_use", "name": tool, "input": {"file_path": fp}})
    return {
        "type": "assistant",
        "message": {
            "id": mid,
            "usage": {"input_tokens": 5, "output_tokens": 10,
                      "cache_creation_input_tokens": cache_creation,
                      "cache_read_input_tokens": 0},
            "content": content,
        },
    }


class TestExtractSession(unittest.TestCase):
    def setUp(self):
        self.lines = [
            {"type": "user", "message": {"content": "first"}, "cwd": "/repo",
             "gitBranch": "main", "timestamp": "2026-06-01T10:00:00Z"},
            _assistant("m1", 1000, "Read", "/a.py"),     # warmup cache_creation
            _assistant("m2", 200, "Read", "/a.py"),      # dup read
            {"type": "user", "message": {"content": "second"}},
            _assistant("m3", 300, "Edit", "/b.py"),
            _assistant("m4", 100, "Edit", "/b.py"),      # dup edit
            {"type": "user", "message": {"content": "third"}},
            _assistant("m5", 50),
        ]
        self.path = _write_jsonl(self.lines)

    def tearDown(self):
        os.remove(self.path)

    def test_basic_counts(self):
        rec = signals.extract_session(self.path)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["turns"], 3)
        self.assertEqual(rec["assistant_msgs"], 5)
        self.assertEqual(rec["tool_calls"], 4)
        self.assertEqual(rec["cwd"], "/repo")
        self.assertEqual(rec["git_branch"], "main")

    def test_w2_excludes_warmup(self):
        rec = signals.extract_session(self.path)
        # cache_creation 합 1650 - 첫(워밍업) 1000 = 650
        self.assertEqual(rec["cache_creation"], 1650)
        self.assertEqual(rec["w2_raw"], 650)

    def test_w3_w4_duplicates(self):
        rec = signals.extract_session(self.path)
        self.assertEqual(rec["reads"], 2)
        self.assertEqual(rec["w3_raw"], 1)   # /a.py 2회 - 고유 1 = 1
        self.assertEqual(rec["edits"], 2)
        self.assertEqual(rec["wc_raw"], 1)   # /b.py 2회 - 고유 1 = 1

    def test_total_tokens(self):
        rec = signals.extract_session(self.path)
        # input 5*5 + output 10*5 + cache_creation 1650 + cache_read 0
        self.assertEqual(rec["total_tokens"], 25 + 50 + 1650 + 0)

    def test_bash_repeats(self):
        def bash_asst(mid, cmd):
            return {"type": "assistant", "message": {
                "id": mid,
                "usage": {"input_tokens": 1, "output_tokens": 1,
                          "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
                "content": [{"type": "tool_use", "name": "Bash", "input": {"command": cmd}}]}}
        path = _write_jsonl([
            {"type": "user", "message": {"content": "p1"}},
            bash_asst("m1", "ls -la"),
            {"type": "user", "message": {"content": "p2"}},
            bash_asst("m2", "ls -la"),       # dup
            bash_asst("m3", "git status"),
            {"type": "user", "message": {"content": "p3"}},
            bash_asst("m4", "ls -la"),       # dup again
        ])
        try:
            rec = signals.extract_session(path)
            # ls -la ×3 + git status ×1 → 4 bash, 고유 2 → bash_raw = 2
            self.assertEqual(rec["bash_raw"], 2)
        finally:
            os.remove(path)

    def test_below_threshold_returns_none(self):
        path = _write_jsonl([
            {"type": "user", "message": {"content": "only one"}},
            _assistant("m1", 100),
        ])
        try:
            self.assertIsNone(signals.extract_session(path))
        finally:
            os.remove(path)

    def test_malformed_lines_skipped(self):
        path = _write_jsonl(self.lines)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("{not valid json\n")
            fh.write("\n")
        try:
            rec = signals.extract_session(path)
            self.assertIsNotNone(rec)   # 깨진 라인 무시하고 정상 파싱
            self.assertEqual(rec["turns"], 3)
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
