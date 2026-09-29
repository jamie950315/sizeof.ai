import json
from collections import defaultdict
import os
import threading
import time
from pathlib import Path
import re
import shutil
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .db import connect, count_models, get_meta, load_models
from .status import read_status

DB_PATH = os.environ.get('SIZEOF_SEARCH_DB', '/data/models.sqlite')
TOKEN = os.environ.get('SIZEOF_SEARCH_TOKEN', '')
HOST_NAME = os.environ.get('SIZEOF_SEARCH_HOST', 'unknown')
LISTEN = os.environ.get('SIZEOF_SEARCH_LISTEN', '0.0.0.0')
PORT = int(os.environ.get('SIZEOF_SEARCH_PORT', '8788'))

STATE = {
    'models': [],
    'indexes': {
        'name1': {},
        'name2': {},
        'owner1': {},
        'owner2': {},
        'name_exact': {},
        'owner_exact': {},
    },
    'count': 0,
    'updated_at': None,
    'loaded_at': 0.0,
    'reload_error': None,
}
LOCK = threading.Lock()


def _popularity(model: dict) -> tuple:
    return (-int(model.get('trending') or 0), -int(model.get('downloads') or 0), model['id'].lower())


def build_indexes(models: list[dict]) -> dict[str, dict[str, list[dict]]]:
    name1: dict[str, list[dict]] = defaultdict(list)
    name2: dict[str, list[dict]] = defaultdict(list)
    owner1: dict[str, list[dict]] = defaultdict(list)
    owner2: dict[str, list[dict]] = defaultdict(list)
    name_exact: dict[str, list[dict]] = defaultdict(list)
    owner_exact: dict[str, list[dict]] = defaultdict(list)
    # One ordering is shared by all buckets; sorting each bucket separately
    # recomputes ranking keys up to six times for every model.
    for model in sorted(models, key=_popularity):
        name = model['name'].lower()
        owner = model['owner'].lower()
        if name:
            name1[name[:1]].append(model)
            name_exact[name].append(model)
            if len(name) >= 2:
                name2[name[:2]].append(model)
        if owner:
            owner1[owner[:1]].append(model)
            owner_exact[owner].append(model)
            if len(owner) >= 2:
                owner2[owner[:2]].append(model)
    return {
        'name1': dict(name1),
        'name2': dict(name2),
        'owner1': dict(owner1),
        'owner2': dict(owner2),
        'name_exact': dict(name_exact),
        'owner_exact': dict(owner_exact),
    }


def _bucket(indexes: dict, kind: str, query: str) -> list[dict]:
    if len(query) >= 2:
        return indexes.get(f'{kind}2', {}).get(query[:2], [])
    return indexes.get(f'{kind}1', {}).get(query[:1], [])


def search(query: str, author: str, model_type: str, limit: int, offset: int) -> tuple[list[dict], bool]:
    q = query.lower()
    author_l = author.lower()
    needed = offset + limit + 1
    with LOCK:
        indexes = STATE['indexes']
    seen: set[str] = set()
    results: list[dict] = []

    def take(items: list[dict], pred) -> None:
        if len(results) >= needed:
            return
        for model in items:
            ident = model['id']
            if ident in seen or not pred(model):
                continue
            if author_l and model['owner'].lower() != author_l:
                continue
            if model_type and (model.get('task') or '') != model_type:
                continue
            seen.add(ident)
            results.append(model)
            if len(results) >= needed:
                return

    if '/' in q:
        owner_part, name_part = q.split('/', 1)
        items = indexes.get('owner_exact', {}).get(owner_part) or _bucket(indexes, 'owner', owner_part)
        take(items, lambda model, query=q, owner_part=owner_part, name_part=name_part: (
            model['id'].lower().startswith(query)
            or (model['owner'].lower() == owner_part and model['name'].lower().startswith(name_part))
        ))
    else:
        owner_items = _bucket(indexes, 'owner', q)
        name_items = _bucket(indexes, 'name', q)
        if len(q) > 1:
            take(indexes.get('owner_exact', {}).get(q, []), lambda _model: True)
        if len(q) >= 4:
            take(indexes.get('name_exact', {}).get(q, []), lambda _model: True)
        take(name_items, lambda model, query=q: model['name'].lower().startswith(query))
        take(owner_items, lambda model, query=q: model['owner'].lower().startswith(query))
    page = results[offset:offset + limit]
    return page, len(results) > offset + limit


def public_model(model: dict) -> dict:
    return {
        'id': model['id'],
        'owner': model['owner'],
        'name': model['name'],
        'downloads': int(model.get('downloads') or 0),
        'likes': int(model.get('likes') or 0),
        'task': model.get('task'),
        'trendingScore': int(model.get('trending') or 0),
        'gated': bool(model.get('gated')),
    }


def reload_models() -> None:
    generation = None
    if os.environ.get('SIZEOF_SEARCH_SERVE_SNAPSHOT', '').lower() == 'true':
        manifest = json.loads((Path(DB_PATH).parent / 'snapshot.json').read_text())
        generation = manifest['generation']
        if not re.fullmatch(r'[a-f0-9]{64}', generation):
            raise ValueError('Invalid published generation')
        db = sqlite3.connect(f'file:{Path(DB_PATH).parent / ("snapshot-" + generation + ".sqlite")}?mode=ro&immutable=1', uri=True)
        db.row_factory = sqlite3.Row
    else:
        db = connect(DB_PATH)
    try:
        db.execute('BEGIN')
        generation = generation or get_meta(db, 'snapshot_generation')
        updated = get_meta(db, 'updated_at')
        backfill_done = get_meta(db, 'full_backfill_done')
        backfill_at = get_meta(db, 'full_backfill_completed_at')
        total = count_models(db)
        with LOCK:
            unchanged = total == STATE['count'] and updated == STATE['updated_at'] and generation == STATE.get('generation') and STATE['count'] > 0
            if unchanged:
                STATE['reload_error'] = None
        if unchanged:
            return
        models = load_models(db)
    finally:
        db.close()
    indexes = build_indexes(models)
    with LOCK:
        STATE['models'] = models
        STATE['indexes'] = indexes
        STATE['count'] = total
        STATE['updated_at'] = updated
        STATE['initial_backfill_complete'] = None if backfill_done is None else backfill_done == 'true'
        STATE['last_full_backfill_at'] = backfill_at
        STATE['generation'] = generation
        STATE['loaded_at'] = time.time()
        STATE['reload_error'] = None
    print(json.dumps({'message': 'index ready', 'host': HOST_NAME, 'models': total}), flush=True)


def refresh_loop() -> None:
    while True:
        time.sleep(60)
        try:
            reload_models()
        except Exception as error:
            with LOCK:
                STATE['reload_error'] = type(error).__name__
            print(json.dumps({'message': 'reload failed', 'error': str(error)}), flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        return

    def _unauthorized(self) -> None:
        self.send_response(401)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"error":"unauthorized"}')

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith('/__sizeof_index'):
            path = path[len('/__sizeof_index'):] or '/'
        if path == '/health':
            role = 'indexer' if os.environ.get('SIZEOF_SEARCH_SERVE_SNAPSHOT', '').lower() == 'true' else 'replica'
            sync_status = read_status(DB_PATH, role)
            with LOCK:
                ready = STATE['count'] > 0
                sync_healthy = not STATE.get('reload_error') and (sync_status is None or sync_status['ok'])
                healthy = ready and sync_healthy
                payload = {
                    'ok': healthy,
                    'ready': ready,
                    'syncHealthy': bool(sync_healthy),
                    'degraded': ready and not sync_healthy,
                    'host': HOST_NAME,
                    'models': STATE['count'],
                    'updatedAt': STATE['updated_at'],
                    'generation': STATE.get('generation'),
                    'initialBackfillComplete': STATE.get('initial_backfill_complete'),
                    'lastFullBackfillAt': STATE.get('last_full_backfill_at'),
                    'reloadError': STATE.get('reload_error'),
                    'sync': sync_status,
                }
            # Never hold the search-state lock while writing to a slow client.
            self._json(payload, 200 if healthy else 503)
            return
        auth = self.headers.get('Authorization', '')
        if not TOKEN or auth != f'Bearer {TOKEN}':
            self._unauthorized()
            return
        if path == '/snapshot' or path.startswith('/snapshot/'):
            if os.environ.get('SIZEOF_SEARCH_SERVE_SNAPSHOT', '').lower() != 'true':
                self._json({'error': 'not found'}, 404)
                return
            if path == '/snapshot':
                try:
                    self._json(json.loads((Path(DB_PATH).parent / 'snapshot.json').read_text()))
                except FileNotFoundError:
                    self._json({'error': 'snapshot not ready'}, 503)
                return
            match = re.fullmatch(r'/snapshot/([a-f0-9]{64})\.sqlite\.gz', path)
            if not match:
                self._json({'error': 'not found'}, 404)
                return
            try:
                stream = (Path(DB_PATH).parent / f'snapshot-{match[1]}.sqlite.gz').open('rb')
            except FileNotFoundError:
                self._json({'error': 'snapshot expired'}, 404)
                return
            with stream:
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(os.fstat(stream.fileno()).st_size))
                self.end_headers()
                shutil.copyfileobj(stream, self.wfile)
            return
        if path != '/search':
            self._json({'error': 'not found'}, 404)
            return
        params = parse_qs(parsed.query)
        query = (params.get('q') or [''])[0].strip()
        author = (params.get('author') or [''])[0].strip()
        model_type = (params.get('type') or [''])[0].strip()
        cursor = (params.get('cursor') or [''])[0].strip()
        if not query or len(query) > 80:
            self._json({'error': 'invalid query'}, 400)
            return
        if cursor and (not re.fullmatch(r'[0-9]{1,7}', cursor)):
            self._json({'error': 'invalid cursor'}, 400)
            return
        offset = int(cursor) if cursor else 0
        with LOCK:
            count = STATE['count']
        if not count:
            self._json({'error': 'index not ready'}, 503)
            return
        # Out-of-range pages cannot match; avoid scanning the entire index.
        if offset > count:
            self._json({'error': 'cursor exceeds index size'}, 400)
            return
        models, has_more = search(query, author, model_type, 12, offset)
        self._json({
            'query': query,
            'models': [public_model(model) for model in models],
            'nextCursor': str(offset + 12) if has_more else None,
            'source': HOST_NAME,
            'indexSize': STATE['count'],
        })


def main() -> None:
    if not TOKEN:
        raise SystemExit('SIZEOF_SEARCH_TOKEN is required')
    reload_models()
    threading.Thread(target=refresh_loop, daemon=True).start()
    server = ThreadingHTTPServer((LISTEN, PORT), Handler)
    print(json.dumps({'message': 'sizeof search listening', 'host': HOST_NAME, 'port': PORT, 'models': STATE['count']}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
