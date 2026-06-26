"""SQLite 영속 저장 (M0 필수).

transcript JSONL은 30일 TTL·비공식 포맷이므로(R4b) 원시 신호를 영구 저장해
시계열 단절을 막는다. 잔차는 코퍼스 의존이라 분석 시 재계산(재현 가능).
근거: docs/waste-aware-eval-design.md L3, 7장.
"""
from __future__ import annotations

import json
import os
import sqlite3

DEFAULT_DB = os.path.expanduser("~/.efficio/efficio.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS work_units (
    session_id      TEXT PRIMARY KEY,
    project         TEXT,
    cwd             TEXT,
    git_branch      TEXT,
    ai_title        TEXT,
    ts_first        REAL,
    ts_last         REAL,
    turns           INTEGER,
    assistant_msgs  INTEGER,
    tool_calls      INTEGER,
    reads           INTEGER,
    edits           INTEGER,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    cache_creation  INTEGER,
    cache_read      INTEGER,
    total_tokens    INTEGER,
    w2_raw          REAL,
    w3_raw          REAL,
    wc_raw          REAL,
    bash_raw        REAL,
    ingested_at     REAL
);
CREATE INDEX IF NOT EXISTS idx_wu_ts ON work_units(ts_first);

CREATE TABLE IF NOT EXISTS reference_model (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    fit_at   REAL,
    n        INTEGER,
    payload  TEXT
);

CREATE TABLE IF NOT EXISTS scores (
    session_id        TEXT,
    axis              TEXT,
    model_version     INTEGER,
    actual            REAL,
    baseline          REAL,
    residual          REAL,
    waste_percentile  REAL,
    is_zero           INTEGER,
    scored_at         REAL,
    PRIMARY KEY (session_id, axis, model_version)
);
CREATE INDEX IF NOT EXISTS idx_scores_axis ON scores(axis, model_version);
"""

_COLUMNS = [
    "session_id", "project", "cwd", "git_branch", "ai_title", "ts_first", "ts_last",
    "turns", "assistant_msgs", "tool_calls", "reads", "edits",
    "input_tokens", "output_tokens", "cache_creation", "cache_read", "total_tokens",
    "w2_raw", "w3_raw", "wc_raw", "bash_raw", "ingested_at",
]

_SCORE_COLUMNS = [
    "session_id", "axis", "model_version",
    "actual", "baseline", "residual", "waste_percentile", "is_zero", "scored_at",
]


class Store:
    """work_units 영속 저장소. 원시 신호만 저장(잔차는 비저장·재계산)."""

    def __init__(self, db_path: str = DEFAULT_DB):
        if db_path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        """기존 DB에 누락 컬럼 추가(ADD COLUMN). 신규 신호 도입 시 하위호환."""
        existing = {r[1] for r in self.conn.execute("PRAGMA table_info(work_units)")}
        for col in ("bash_raw",):
            if col not in existing:
                self.conn.execute(f"ALTER TABLE work_units ADD COLUMN {col} REAL")
        self.conn.commit()

    def upsert(self, rec: dict, ingested_at: float) -> None:
        """레코드 upsert. 동일 session_id는 최신 신호로 갱신(재현 가능)."""
        row = {k: rec.get(k) for k in _COLUMNS}
        row["ingested_at"] = ingested_at
        placeholders = ", ".join("?" for _ in _COLUMNS)
        updates = ", ".join(f"{c}=excluded.{c}" for c in _COLUMNS if c != "session_id")
        self.conn.execute(
            f"INSERT INTO work_units ({', '.join(_COLUMNS)}) VALUES ({placeholders}) "
            f"ON CONFLICT(session_id) DO UPDATE SET {updates}",
            [row[c] for c in _COLUMNS],
        )

    def commit(self) -> None:
        self.conn.commit()

    def all_units(self) -> list[dict]:
        cur = self.conn.execute("SELECT * FROM work_units ORDER BY ts_first")
        return [dict(r) for r in cur.fetchall()]

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM work_units").fetchone()[0]

    def save_reference(self, model: dict) -> int:
        """기준 모델을 새 버전으로 저장. 반환: model_version(row id). 최신=활성."""
        cur = self.conn.execute(
            "INSERT INTO reference_model (fit_at, n, payload) VALUES (?, ?, ?)",
            (model.get("fit_at"), model.get("n"), json.dumps(model)),
        )
        self.conn.commit()
        return cur.lastrowid

    def replace_scores(self, model_version: int, rows: list[dict], scored_at: float) -> int:
        """한 기준모델 버전의 점수를 통째로 교체(재현 가능). 반환: 기록 행 수.

        server(읽기 브리지)가 통계를 재계산하지 않도록 efficio가 미리 채점해 둔다.
        같은 model_version은 전체 삭제 후 재기록(부분 갱신 아님 → 일관성).
        """
        self.conn.execute("DELETE FROM scores WHERE model_version=?", (model_version,))
        placeholders = ", ".join("?" for _ in _SCORE_COLUMNS)
        payload = []
        for r in rows:
            rec = {k: r.get(k) for k in _SCORE_COLUMNS}
            rec["model_version"] = model_version
            rec["scored_at"] = scored_at
            rec["is_zero"] = 1 if r.get("is_zero") else 0
            payload.append([rec[c] for c in _SCORE_COLUMNS])
        self.conn.executemany(
            f"INSERT INTO scores ({', '.join(_SCORE_COLUMNS)}) VALUES ({placeholders})",
            payload,
        )
        self.conn.commit()
        return len(payload)

    def scores_for(self, axis: str, model_version: int) -> list[dict]:
        """한 축·기준모델의 점수 행(검증·테스트용)."""
        cur = self.conn.execute(
            "SELECT * FROM scores WHERE axis=? AND model_version=?",
            (axis, model_version),
        )
        return [dict(r) for r in cur.fetchall()]

    def load_reference(self):
        """최신(활성) 기준 모델 로드. 없으면 None. model_version 키 포함."""
        row = self.conn.execute(
            "SELECT id, payload FROM reference_model ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        model = json.loads(row["payload"])
        model["model_version"] = row["id"]
        return model

    def close(self) -> None:
        self.conn.close()
