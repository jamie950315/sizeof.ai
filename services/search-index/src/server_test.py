import json
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import unittest
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from . import server as server_mod
from .server import (
    Handler,
    LOCK,
    STATE,
    build_indexes,
    public_model,
    reload_models,
    search,
)


def model(ident: str, downloads: int = 0, trending: int = 0, task: str | None = None, gated: int = 0) -> dict:
    owner, name = ident.split('/', 1)
    return {
        'id': ident,
        'owner': owner,
        'name': name,
        'downloads': downloads,
        'likes': 0,
        'task': task,
        'trending': trending,
        'gated': gated,
    }


FIXTURES = [
    model('q/obscure', downloads=9_000_000, trending=9_000),
    model('someone/q', downloads=50, trending=1),
    model('Qwen/Qwen3-0.6B', downloads=2_000_000, trending=2_200, task='text-generation'),
    model('Qwen/Qwen2.5-7B', downloads=1_500_000, trending=1_800, task='text-generation'),
    model('Qwen/Qwen3-VL', downloads=800_000, trending=900, task='image-text-to-text'),
    model('Community/Qwen-extra', downloads=900_000, trending=1_200, task='text-generation'),
    model('Community/Qwen', downloads=400_000, trending=400, task='text-generation'),
    model('meta-llama/Llama-2-7b', downloads=3_000_000, trending=700, task='text-generation'),
    model('meta-llama/Llama-3-8B', downloads=2_500_000, trending=1_100, task='text-generation'),
    model('mlx-community/Qwen2.5-7B-4bit', downloads=20_000, trending=80, task='text-generation'),
    model('trungzpham/qw', downloads=10, trending=1, task='text-generation'),
    model('mishkashishka/qwe', downloads=12, trending=1, task='text-generation'),
    model('z/short', downloads=1, trending=1),
    model('other/zz-hidden', downloads=10, trending=10),
]


@contextmanager
def loaded(models: list[dict]):
    indexes = build_indexes(models)
    with LOCK:
        previous = {key: STATE[key] for key in ('models', 'indexes', 'count', 'updated_at')}
        STATE['models'] = models
        STATE['indexes'] = indexes
        STATE['count'] = len(models)
        STATE['updated_at'] = 'test'
    try:
        yield
    finally:
        with LOCK:
            STATE.update(previous)


class BuildIndexTests(unittest.TestCase):
    def test_one_character_names_are_absent_from_two_character_buckets(self):
        indexes = build_indexes([model('someone/q'), model('Qwen/Qwen3-0.6B')])
        self.assertIn('q', indexes['name1'])
        self.assertNotIn('q', indexes['name2'])
        self.assertIn('qw', indexes['name2'])
        self.assertEqual([item['id'] for item in indexes['owner2']['qw']], ['Qwen/Qwen3-0.6B'])
        self.assertEqual([item['id'] for item in indexes['owner_exact']['qwen']], ['Qwen/Qwen3-0.6B'])
        self.assertEqual([item['id'] for item in indexes['name_exact']['qwen3-0.6b']], ['Qwen/Qwen3-0.6B'])


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.ctx = loaded(FIXTURES)
        self.ctx.__enter__()

    def tearDown(self):
        self.ctx.__exit__(None, None, None)

    def ids(self, query: str, author: str = '', model_type: str = '', limit: int = 12, offset: int = 0) -> list[str]:
        page, _ = search(query, author, model_type, limit, offset)
        return [item['id'] for item in page]

    def test_single_character_does_not_prefer_exact_name_q(self):
        ids = self.ids('Q')
        self.assertEqual(ids[0], 'Qwen/Qwen3-0.6B')
        self.assertIn('someone/q', ids)
        self.assertGreater(ids.index('someone/q'), ids.index('Qwen/Qwen3-0.6B'))

    def test_single_character_skips_exact_owner_match(self):
        ids = self.ids('Q')
        self.assertGreater(ids.index('q/obscure'), ids.index('Qwen/Qwen3-0.6B'))
        self.assertGreater(ids.index('q/obscure'), ids.index('Community/Qwen'))

    def test_qwen_prefers_exact_owner_over_community_name_prefix(self):
        ids = self.ids('Qwen')
        self.assertEqual(ids[:3], ['Qwen/Qwen3-0.6B', 'Qwen/Qwen2.5-7B', 'Qwen/Qwen3-VL'])
        self.assertGreater(ids.index('Community/Qwen'), ids.index('Qwen/Qwen3-VL'))
        self.assertGreater(ids.index('Community/Qwen-extra'), ids.index('Qwen/Qwen3-VL'))

    def test_case_insensitive_queries(self):
        self.assertEqual(self.ids('qwen'), self.ids('QWEN'))
        self.assertEqual(self.ids('qwen'), self.ids('Qwen'))

    def test_author_filter(self):
        ids = self.ids('Qwen', author='Qwen')
        self.assertEqual(ids, ['Qwen/Qwen3-0.6B', 'Qwen/Qwen2.5-7B', 'Qwen/Qwen3-VL'])
        self.assertNotIn('Community/Qwen', ids)

    def test_type_filter(self):
        ids = self.ids('Qwen', model_type='image-text-to-text')
        self.assertEqual(ids, ['Qwen/Qwen3-VL'])

    def test_author_and_type_filters_together(self):
        ids = self.ids('Q', author='Qwen', model_type='text-generation')
        self.assertEqual(ids, ['Qwen/Qwen3-0.6B', 'Qwen/Qwen2.5-7B'])

    def test_pagination_has_more_and_no_duplicates(self):
        first, more = search('Q', '', '', 3, 0)
        second, more_second = search('Q', '', '', 3, 3)
        third, more_third = search('Q', '', '', 3, 6)
        ids = [item['id'] for item in first + second + third]
        self.assertTrue(more)
        self.assertTrue(more_second)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids[:3], [item['id'] for item in first])
        all_ids, trailing = search('Q', '', '', 50, 0)
        self.assertFalse(trailing)
        self.assertEqual(ids, [item['id'] for item in all_ids[:9]])

    def test_no_match_and_empty_query_return_empty(self):
        page, more = search('zzzx-no-such-model', '', '', 12, 0)
        self.assertEqual(page, [])
        self.assertFalse(more)
        empty, empty_more = search('', '', '', 12, 0)
        self.assertEqual(empty, [])
        self.assertFalse(empty_more)

    def test_duplicate_across_name_and_owner_buckets_is_counted_once(self):
        ids = self.ids('Qwen')
        self.assertEqual(ids.count('Qwen/Qwen3-0.6B'), 1)

    def test_two_character_prefix_does_not_return_one_character_names(self):
        self.assertNotIn('z/short', self.ids('zz'))
        self.assertEqual(self.ids('zz'), ['other/zz-hidden'])

    def test_short_prefix_prefers_popular_names_over_exact_short_names(self):
        self.assertEqual(self.ids('Qw')[0], 'Qwen/Qwen3-0.6B')
        self.assertEqual(self.ids('Qwe')[0], 'Qwen/Qwen3-0.6B')
        self.assertGreater(self.ids('Qw').index('trungzpham/qw'), self.ids('Qw').index('Qwen/Qwen3-0.6B'))

    def test_full_id_matches_when_name_prefix_differs_from_owner(self):
        self.assertEqual(self.ids('meta-llama/Llama-3-8B'), ['meta-llama/Llama-3-8B'])
        self.assertIn('meta-llama/Llama-2-7b', self.ids('meta-llama/Llama'))
        self.assertIn('Qwen/Qwen3-0.6B', self.ids('Qwen/Qwen3'))
        self.assertEqual(self.ids('Qwen/')[0], 'Qwen/Qwen3-0.6B')
        self.assertEqual(self.ids('Community/Qwen-extra'), ['Community/Qwen-extra'])

    def test_empty_index_returns_empty(self):
        with loaded([]):
            page, more = search('Qwen', '', '', 12, 0)
            self.assertEqual(page, [])
            self.assertFalse(more)


class PublicModelTests(unittest.TestCase):
    def test_public_model_normalizes_counts_and_gated_flag(self):
        payload = public_model(model('Qwen/Qwen3-0.6B', downloads=3, trending=4, task='text-generation', gated=1))
        self.assertEqual(payload, {
            'id': 'Qwen/Qwen3-0.6B',
            'owner': 'Qwen',
            'name': 'Qwen3-0.6B',
            'downloads': 3,
            'likes': 0,
            'task': 'text-generation',
            'trendingScore': 4,
            'gated': True,
        })


class ReloadTests(unittest.TestCase):
    def test_reload_skips_when_count_and_timestamp_are_unchanged(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        from . import db, server

        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / 'models.sqlite')
            conn = db.connect(path)
            db.upsert_models(conn, [{
                **model('Qwen/Qwen3-0.6B', downloads=1, trending=1),
                'id_lower': 'qwen/qwen3-0.6b',
                'owner_lower': 'qwen',
                'name_lower': 'qwen3-0.6b',
            }])
            db.set_meta(conn, 'updated_at', 'stamp-1')
            conn.close()
            with patch.object(server, 'DB_PATH', path), loaded([]):
                reload_models()
                first_loaded = STATE['loaded_at']
                self.assertEqual(STATE['count'], 1)
                reload_models()
                self.assertEqual(STATE['loaded_at'], first_loaded)


class SearchHttpTests(unittest.TestCase):
    @contextmanager
    def published_snapshot(self):
        from . import db
        from .indexer import normalize
        from .snapshot import publish_snapshot
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'models.sqlite')
            conn = db.connect(path)
            db.upsert_models(conn, [normalize({'id': 'org/published'})])
            db.set_meta(conn, 'updated_at', '2026-09-08T00:00:00Z')
            conn.close()
            manifest = publish_snapshot(path)
            with patch.object(server_mod, 'DB_PATH', path), \
                 patch.dict(os.environ, {'SIZEOF_SEARCH_SERVE_SNAPSHOT': 'true'}):
                yield manifest

    def setUp(self):
        self.previous_token = server_mod.TOKEN
        self.previous_host = server_mod.HOST_NAME
        server_mod.TOKEN = 'secret-token'
        server_mod.HOST_NAME = 'test-index'
        self.state = loaded(FIXTURES)
        self.state.__enter__()
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.state.__exit__(None, None, None)
        server_mod.TOKEN = self.previous_token
        server_mod.HOST_NAME = self.previous_host

    def get(self, path: str, token: str | None = 'secret-token'):
        headers = {}
        if token is not None:
            headers['Authorization'] = f'Bearer {token}'
        request = Request(self.base + path, headers=headers)
        try:
            with urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read().decode()), dict(response.headers)
        except HTTPError as error:
            body = error.read().decode()
            payload = json.loads(body) if body else {}
            headers = dict(error.headers)
            error.close()
            return error.code, payload, headers

    def test_health_does_not_need_auth(self):
        status, payload, _ = self.get('/health', token=None)
        self.assertEqual(status, 200)
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['host'], 'test-index')
        self.assertEqual(payload['models'], len(FIXTURES))

    def test_sizeof_index_prefix_is_stripped(self):
        status, payload, _ = self.get('/__sizeof_index/health', token=None)
        self.assertEqual(status, 200)
        self.assertEqual(payload['host'], 'test-index')

    def test_search_requires_bearer_token(self):
        status, payload, _ = self.get('/search?q=Qwen', token=None)
        self.assertEqual(status, 401)
        self.assertEqual(payload, {'error': 'unauthorized'})

    def test_search_rejects_empty_and_overlong_queries(self):
        empty_status, empty_payload, _ = self.get('/search?q=%20')
        long_status, long_payload, _ = self.get('/search?q=' + ('a' * 81))
        self.assertEqual(empty_status, 400)
        self.assertEqual(empty_payload, {'error': 'invalid query'})
        self.assertEqual(long_status, 400)
        self.assertEqual(long_payload, {'error': 'invalid query'})

    def test_search_accepts_single_character_and_max_length(self):
        short_status, short_payload, _ = self.get('/search?q=Q')
        long_status, _, _ = self.get('/search?q=' + ('Q' * 80))
        self.assertEqual(short_status, 200)
        self.assertEqual(short_payload['models'][0]['id'], 'Qwen/Qwen3-0.6B')
        self.assertEqual(short_payload['source'], 'test-index')
        self.assertEqual(short_payload['indexSize'], len(FIXTURES))
        self.assertEqual(long_status, 200)

    def test_search_pagination_cursor_and_filters(self):
        first_status, first, _ = self.get('/search?q=Qwen&author=Qwen&type=text-generation')
        self.assertEqual(first_status, 200)
        self.assertEqual([item['id'] for item in first['models']], ['Qwen/Qwen3-0.6B', 'Qwen/Qwen2.5-7B'])
        self.assertIsNone(first['nextCursor'])
        page1, first_page, _ = self.get('/search?q=Q')
        page2, second_page, _ = self.get('/search?q=Q&cursor=12')
        self.assertEqual(page1, 200)
        self.assertIsNone(first_page['nextCursor'])
        self.assertEqual(page2, 200)
        self.assertEqual(second_page['models'], [])

    def test_unknown_path_is_not_found(self):
        status, payload, _ = self.get('/nope')
        self.assertEqual(status, 404)
        self.assertEqual(payload, {'error': 'not found'})

    def test_snapshot_requires_auth_and_download_matches_manifest(self):
        with self.published_snapshot() as expected:
            archive_path = f"/snapshot/{expected['generation']}.sqlite.gz"
            for path in ('/snapshot', archive_path):
                for token in (None, 'incorrect-token'):
                    self.assertEqual(self.get(path, token=token)[0], 401)
            status, manifest, _headers = self.get('/__sizeof_index/snapshot')
            self.assertEqual(status, 200)
            self.assertEqual(manifest, expected)
            request = Request(self.base + '/__sizeof_index' + archive_path,
                              headers={'Authorization': 'Bearer secret-token'})
            with urlopen(request, timeout=2) as response:
                archive = response.read()
                self.assertEqual(int(response.headers['Content-Length']), len(archive))
            self.assertEqual(len(archive), manifest['bytes'])
            self.assertEqual(hashlib.sha256(archive).hexdigest(), manifest['sha256'])

    def test_snapshot_disabled_even_when_files_exist(self):
        with self.published_snapshot() as manifest, \
             patch.dict(os.environ, {'SIZEOF_SEARCH_SERVE_SNAPSHOT': 'false'}):
            self.assertEqual(self.get('/snapshot')[0], 404)
            self.assertEqual(self.get(f"/snapshot/{manifest['generation']}.sqlite.gz")[0], 404)

    def test_snapshot_rejects_invalid_paths_and_unknown_generation(self):
        with self.published_snapshot():
            for path in ('/snapshot/../../models.sqlite', '/snapshot/%2e%2e/models.sqlite',
                         '/snapshot/not-a-hash.sqlite.gz', '/snapshot/' + 'A' * 64 + '.sqlite.gz',
                         '/snapshot/' + '0' * 64 + '.sqlite.gz'):
                with self.subTest(path=path):
                    self.assertEqual(self.get(path)[0], 404)

    def test_snapshot_not_ready_returns_503(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(server_mod, 'DB_PATH', str(Path(directory) / 'models.sqlite')), \
             patch.dict(os.environ, {'SIZEOF_SEARCH_SERVE_SNAPSHOT': 'true'}):
            self.assertEqual(self.get('/snapshot')[0], 503)
