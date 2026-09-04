import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from . import db, indexer
from .indexer import next_cursor, normalize, tokens


class NormalizeTests(unittest.TestCase):
    def test_drops_private_and_invalid_ids(self):
        self.assertIsNone(normalize({'id': 'owner/name', 'private': True}))
        self.assertIsNone(normalize({'id': 'nopath'}))
        self.assertIsNone(normalize({'id': '/name'}))
        self.assertIsNone(normalize({'id': 'owner/'}))
        self.assertIsNone(normalize({'id': 12}))
        self.assertIsNone(normalize({}))

    def test_keeps_public_models_and_defaults_counts(self):
        row = normalize({
            'id': 'Qwen/Qwen3-0.6B',
            'private': False,
            'downloads': 12,
            'likes': 3,
            'pipeline_tag': 'text-generation',
            'trendingScore': 8,
            'gated': 'auto',
        })
        self.assertEqual(row['id'], 'Qwen/Qwen3-0.6B')
        self.assertEqual(row['owner'], 'Qwen')
        self.assertEqual(row['name'], 'Qwen3-0.6B')
        self.assertEqual(row['downloads'], 12)
        self.assertEqual(row['likes'], 3)
        self.assertEqual(row['task'], 'text-generation')
        self.assertEqual(row['trending'], 8)
        self.assertEqual(row['gated'], 1)
        self.assertEqual(normalize({'id': 'Qwen/Qwen3-0.6B'})['downloads'], 0)
        self.assertEqual(normalize({'id': 'Qwen/Qwen3-0.6B'})['gated'], 0)
        self.assertIsNone(normalize({'id': 'Qwen/Qwen3-0.6B', 'pipeline_tag': 1})['task'])


class NextCursorTests(unittest.TestCase):
    def test_reads_next_and_ignores_other_rels(self):
        self.assertIsNone(next_cursor(None))
        self.assertIsNone(next_cursor(''))
        self.assertIsNone(next_cursor('<https://huggingface.co/api/models?cursor=abc>; rel="prev"'))
        self.assertEqual(
            next_cursor('<https://huggingface.co/api/models?cursor=abc>; rel="next"'),
            'abc',
        )
        self.assertEqual(
            next_cursor('<https://huggingface.co/api/models?cursor=def>; rel=next'),
            'def',
        )
        self.assertEqual(
            next_cursor(
                '<https://huggingface.co/api/models?cursor=old>; rel="prev", '
                '<https://huggingface.co/api/models?cursor=new>; rel="next"'
            ),
            'new',
        )
        self.assertIsNone(next_cursor('rel="next" without-brackets'))


class TokenPoolTests(unittest.TestCase):
    def test_skips_blanks_dedupes_and_keeps_hf_then_enterprise_order(self):
        env = {
            'HF_TOKEN': ' hf_main ',
            'HF_TOKEN_ENTERPRISE_1': 'hf_one',
            'HF_TOKEN_ENTERPRISE_2': '',
            'HF_TOKEN_ENTERPRISE_3': 'hf_main',
            'HF_TOKEN_ENTERPRISE_4': 'hf_four',
        }
        with patch.dict(os.environ, env, clear=False):
            self.assertEqual(tokens(), ['hf_main', 'hf_one', 'hf_four'])

    def test_empty_pool_when_all_blank(self):
        env = {
            'HF_TOKEN': '',
            'HF_TOKEN_ENTERPRISE_1': '  ',
            'HF_TOKEN_ENTERPRISE_2': '',
            'HF_TOKEN_ENTERPRISE_3': '',
            'HF_TOKEN_ENTERPRISE_4': '',
        }
        with patch.dict(os.environ, env, clear=False):
            self.assertEqual(tokens(), [])



class CrawlOnceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / 'models.sqlite')
        self.db_patch = patch.object(indexer, 'DB_PATH', self.db_path)
        self.sleep_patch = patch.object(indexer.time, 'sleep')
        self.db_patch.start()
        self.sleep_patch.start()

    def tearDown(self):
        self.sleep_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def fake_pages(self, by_sort: dict):
        remaining = {key: list(value) for key, value in by_sort.items()}
        urls: list[str] = []

        def fake_request(url, _token):
            urls.append(url)
            sort = 'createdAt' if 'sort=createdAt' in url else 'downloads'
            pages = remaining[sort]
            if not pages:
                return 200, [], None
            return pages.pop(0)

        return fake_request, urls

    def test_stops_when_cursor_repeats(self):
        fake_request, urls = self.fake_pages({
            'downloads': [
                (200, [{'id': 'org/a', 'private': False}], '<https://huggingface.co/api/models?cursor=abc>; rel="next"'),
                (200, [{'id': 'org/b', 'private': False}], '<https://huggingface.co/api/models?cursor=abc>; rel="next"'),
                (200, [{'id': 'org/c', 'private': False}], '<https://huggingface.co/api/models?cursor=def>; rel="next"'),
            ],
            'createdAt': [
                (200, [{'id': 'org/a', 'private': False}], None),
            ],
        })
        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            total = indexer.crawl_once()
        conn = db.connect(self.db_path)
        ids = [row['id'] for row in conn.execute('SELECT id FROM models ORDER BY id')]
        conn.close()
        self.assertEqual(total, 2)
        self.assertEqual(ids, ['org/a', 'org/b'])
        self.assertTrue(any('sort=downloads' in url for url in urls))
        self.assertTrue(any('sort=createdAt' in url for url in urls))

    def test_last_modified_keeps_going_while_new_models_appear(self):
        conn = db.connect(self.db_path)
        db.upsert_models(conn, [{
            'id': 'org/old', 'owner': 'org', 'name': 'old',
            'id_lower': 'org/old', 'owner_lower': 'org', 'name_lower': 'old',
            'downloads': 1, 'likes': 0, 'task': None, 'trending': 0, 'gated': 0,
        }])
        conn.close()
        fake_request, urls = self.fake_pages({
            'downloads': [(200, [{'id': 'org/old', 'private': False, 'downloads': 9}], None)],
            'createdAt': [
                (200, [{'id': 'org/new-1', 'private': False}], '<https://huggingface.co/api/models?cursor=n1>; rel="next"'),
                (200, [{'id': 'org/new-2', 'private': False}], '<https://huggingface.co/api/models?cursor=n2>; rel="next"'),
                (200, [{'id': 'org/old', 'private': False}], '<https://huggingface.co/api/models?cursor=n3>; rel="next"'),
                (200, [{'id': 'org/old', 'private': False}], '<https://huggingface.co/api/models?cursor=n4>; rel="next"'),
                (200, [{'id': 'org/old', 'private': False}], '<https://huggingface.co/api/models?cursor=n5>; rel="next"'),
                (200, [{'id': 'org/old', 'private': False}], '<https://huggingface.co/api/models?cursor=n6>; rel="next"'),
                (200, [{'id': 'org/old', 'private': False}], '<https://huggingface.co/api/models?cursor=n7>; rel="next"'),
                (200, [{'id': 'org/missed', 'private': False}], '<https://huggingface.co/api/models?cursor=n8>; rel="next"'),
            ],
        })
        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            indexer.crawl_once()
        conn = db.connect(self.db_path)
        ids = {row['id'] for row in conn.execute('SELECT id FROM models')}
        conn.close()
        self.assertIn('org/new-1', ids)
        self.assertIn('org/new-2', ids)
        self.assertNotIn('org/missed', ids)
        self.assertEqual(sum('sort=createdAt' in url for url in urls), 7)

    def test_populated_index_only_refreshes_a_bounded_downloads_pass(self):
        call = {'downloads': 0, 'createdAt': 0}

        def fake_request(url, _token):
            if 'sort=createdAt' in url:
                call['createdAt'] += 1
                return 200, [{'id': 'org/old', 'private': False}], None
            call['downloads'] += 1
            n = call['downloads']
            return 200, [{'id': f'org/pop-{n}', 'private': False}], f'<https://huggingface.co/api/models?cursor=d{n}>; rel="next"'

        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'count_models', return_value=150_000), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            indexer.crawl_once()
        self.assertEqual(call['downloads'], 30)
        self.assertEqual(call['createdAt'], 1)

    def test_page_zero_failure_stops_that_sort(self):
        fake_request, _urls = self.fake_pages({
            'downloads': [(500, None, None)],
            'createdAt': [(500, None, None)],
        })
        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            total = indexer.crawl_once()
        self.assertEqual(total, 0)

    def test_drops_private_rows_and_retries_after_429(self):
        pages = {
            'downloads': [
                (429, None, None),
                (200, [
                    {'id': 'org/public', 'private': False},
                    {'id': 'org/secret', 'private': True},
                    {'id': 'nopath'},
                ], None),
            ],
            'createdAt': [(200, [{'id': 'org/public', 'private': False}], None)],
        }
        fake_request, _urls = self.fake_pages(pages)
        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            total = indexer.crawl_once()
        conn = db.connect(self.db_path)
        ids = [row['id'] for row in conn.execute('SELECT id FROM models')]
        conn.close()
        self.assertEqual(total, 1)
        self.assertEqual(ids, ['org/public'])
