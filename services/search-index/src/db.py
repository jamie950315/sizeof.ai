import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  id_lower TEXT NOT NULL,
  owner_lower TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  task TEXT,
  trending INTEGER NOT NULL DEFAULT 0,
  gated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_models_name_lower ON models(name_lower);
CREATE INDEX IF NOT EXISTS idx_models_owner_lower ON models(owner_lower);
CREATE INDEX IF NOT EXISTS idx_models_rank ON models(trending DESC, downloads DESC);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""

def connect(path: str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=NORMAL')
    db.executescript(SCHEMA)
    return db

def upsert_models(db: sqlite3.Connection, rows: list[dict]) -> None:
    db.executemany(
        """INSERT INTO models(id, owner, name, id_lower, owner_lower, name_lower, downloads, likes, task, trending, gated)
           VALUES(:id, :owner, :name, :id_lower, :owner_lower, :name_lower, :downloads, :likes, :task, :trending, :gated)
           ON CONFLICT(id) DO UPDATE SET
             owner=excluded.owner, name=excluded.name, id_lower=excluded.id_lower,
             owner_lower=excluded.owner_lower, name_lower=excluded.name_lower,
             downloads=excluded.downloads, likes=excluded.likes, task=excluded.task,
             trending=excluded.trending, gated=excluded.gated
        """,
        rows,
    )
    db.commit()

def set_meta(db: sqlite3.Connection, key: str, value: str) -> None:
    db.execute('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
    db.commit()

def get_meta(db: sqlite3.Connection, key: str) -> str | None:
    row = db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return None if row is None else str(row['value'])

def count_models(db: sqlite3.Connection) -> int:
    row = db.execute('SELECT COUNT(*) AS n FROM models').fetchone()
    return int(row['n'] if row else 0)

def load_models(db: sqlite3.Connection) -> list[dict]:
    rows = db.execute(
        'SELECT id, owner, name, downloads, likes, task, trending, gated FROM models',
    ).fetchall()
    return [dict(row) for row in rows]
