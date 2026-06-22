import unittest

from efficio.store import Store


def _rec(sid, w2=100, tokens=1000, ts=1.0):
    return {
        "session_id": sid, "project": "p", "cwd": "/c", "git_branch": "main",
        "ai_title": "t", "ts_first": ts, "ts_last": ts + 1,
        "turns": 5, "assistant_msgs": 6, "tool_calls": 4, "reads": 2, "edits": 1,
        "input_tokens": 10, "output_tokens": 20, "cache_creation": 30, "cache_read": 40,
        "total_tokens": tokens, "w2_raw": w2, "w3_raw": 1, "wc_raw": 0, "bash_raw": 0,
    }


class TestStore(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")

    def tearDown(self):
        self.store.close()

    def test_upsert_and_roundtrip(self):
        self.store.upsert(_rec("s1", w2=123), ingested_at=99.0)
        self.store.commit()
        units = self.store.all_units()
        self.assertEqual(len(units), 1)
        self.assertEqual(units[0]["session_id"], "s1")
        self.assertEqual(units[0]["w2_raw"], 123)
        self.assertEqual(units[0]["ingested_at"], 99.0)

    def test_upsert_updates_existing(self):
        self.store.upsert(_rec("s1", w2=100), ingested_at=1.0)
        self.store.upsert(_rec("s1", w2=999), ingested_at=2.0)  # 동일 id 갱신
        self.store.commit()
        units = self.store.all_units()
        self.assertEqual(len(units), 1)        # 중복 안 생김
        self.assertEqual(units[0]["w2_raw"], 999)

    def test_count_and_ordering(self):
        self.store.upsert(_rec("late", ts=200.0), ingested_at=1.0)
        self.store.upsert(_rec("early", ts=100.0), ingested_at=1.0)
        self.store.commit()
        self.assertEqual(self.store.count(), 2)
        units = self.store.all_units()
        self.assertEqual(units[0]["session_id"], "early")  # ts_first 오름차순
        self.assertEqual(units[1]["session_id"], "late")


if __name__ == "__main__":
    unittest.main()
