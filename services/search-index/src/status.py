"""Small shared health records for the separate crawler and replica processes."""
import json
import os
from pathlib import Path
import tempfile
import time


def record_status(db_path: str, role: str, error: Exception | None = None) -> None:
    directory = Path(db_path).parent
    directory.mkdir(parents=True, exist_ok=True)
    payload = {'ok': error is None, 'stage': 'crawl-and-publish' if role == 'indexer' else 'snapshot-sync', 'checkedAt': time.time(),
               'errorType': type(error).__name__ if error else None}
    # Do not persist exception strings, URLs, request headers, or credentials.
    with tempfile.NamedTemporaryFile(mode='w', dir=directory, delete=False) as staged:
        temporary = Path(staged.name)
        try:
            json.dump(payload, staged)
            staged.flush()
            os.replace(temporary, directory / f'{role}-status.json')
        finally:
            temporary.unlink(missing_ok=True)


def read_status(db_path: str, role: str) -> dict | None:
    try:
        payload = json.loads((Path(db_path).parent / f'{role}-status.json').read_text())
        if not isinstance(payload, dict) or type(payload.get('ok')) is not bool:
            raise ValueError('Invalid status record')
        return payload
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return {'ok': False, 'errorType': 'UnreadableStatus'}
