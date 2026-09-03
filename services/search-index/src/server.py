import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .db import connect, count_models, get_meta, load_models

DB_PATH = os.environ.get('SIZEOF_SEARCH_DB', '/data/models.sqlite')
TOKEN = os.environ.get('SIZEOF_SEARCH_TOKEN', '')
HOST_NAME = os.environ.get('SIZEOF_SEARCH_HOST', 'unknown')
LISTEN = os.environ.get('SIZEOF_SEARCH_LISTEN', '0.0.0.0')
PORT = int(os.environ.get('SIZEOF_SEARCH_PORT', '8788'))

STATE = {
    'models': [],
    'count': 0,
    'updated_at': None,
    'loaded_at': 0.0,
}
LOCK = threading.Lock()


def rank(model: dict, query: str) -> tuple:
    q = query.lower()
    ident = model['id'].lower()
    owner = model['owner'].lower()
    name = model['name'].lower()
    if ident == q:
        bucket = 0
    elif owner == q and name.startswith(q):
        bucket = 1
    elif owner == q:
        bucket = 2
    elif len(q) > 1 and name == q:
        bucket = 3
    elif name.startswith(q):
        bucket = 4
    elif owner.startswith(q) or ident.startswith(q):
        bucket = 5
    else:
        bucket = 6
    return (bucket, -int(model.get('trending') or 0), -int(model.get('downloads') or 0), ident)


def matches(model: dict, query: str, author: str, model_type: str) -> bool:
    q = query.lower()
    ident = model['id'].lower()
    owner = model['owner'].lower()
    name = model['name'].lower()
    if author and owner != author.lower():
        return False
    if model_type and (model.get('task') or '') != model_type:
        return False
    return name.startswith(q) or owner.startswith(q) or ident.startswith(q)


def search(query: str, author: str, model_type: str, limit: int, offset: int) -> tuple[list[dict], bool]:
    with LOCK:
        models = STATE['models']
    hits = [model for model in models if matches(model, query, author, model_type)]
    hits.sort(key=lambda model: rank(model, query))
    page = hits[offset:offset + limit]
    return page, offset + limit < len(hits)


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
    db = connect(DB_PATH)
    try:
        models = load_models(db)
        updated = get_meta(db, 'updated_at')
        total = count_models(db)
    finally:
        db.close()
    with LOCK:
        STATE['models'] = models
        STATE['count'] = total
        STATE['updated_at'] = updated
        STATE['loaded_at'] = time.time()


def refresh_loop() -> None:
    while True:
        time.sleep(15)
        try:
            reload_models()
        except Exception as error:
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
            with LOCK:
                self._json({
                    'ok': True,
                    'host': HOST_NAME,
                    'models': STATE['count'],
                    'updatedAt': STATE['updated_at'],
                })
            return
        auth = self.headers.get('Authorization', '')
        if not TOKEN or auth != f'Bearer {TOKEN}':
            self._unauthorized()
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
        offset = 0
        if cursor.isdigit():
            offset = int(cursor)
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
