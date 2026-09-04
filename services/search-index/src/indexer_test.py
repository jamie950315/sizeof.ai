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

    def test_stops_when_cursor_repeats(self):
        pages = [
            (200, [{'id': 'org/a', 'private': False}], '<https://huggingface.co/api/models?cursor=abc>; rel="next"'),
            (200, [{'id': 'org/b', 'private': False}], '<https://huggingface.co/api/models?cursor=abc>; rel="next"'),
            (200, [{'id': 'org/c', 'private': False}], '<https://huggingface.co/api/models?cursor=def>; rel="next"'),
        ]

        def fake_request(_url, _token):
            return pages.pop(0)

        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            total = indexer.crawl_once()
        conn = db.connect(self.db_path)
        ids = [row['id'] for row in conn.execute('SELECT id FROM models ORDER BY id')]
        conn.close()
        self.assertEqual(total, 2)
        self.assertEqual(ids, ['org/a', 'org/b'])
        self.assertEqual(pages, [(200, [{'id': 'org/c', 'private': False}], '<https://huggingface.co/api/models?cursor=def>; rel="next"')])

    def test_stops_when_count_stagnates_after_100k(self):
        call = {'n': 0}

        def fake_request(_url, _token):
            call['n'] += 1
            n = call['n']
            return 200, [{'id': f'org/m{n}', 'private': False}], f'<https://huggingface.co/api/models?cursor=c{n}>; rel="next"'

        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'count_models', return_value=100_001), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            indexer.crawl_once()
        self.assertEqual(call['n'], 5)

    def test_page_zero_failure_stops(self):
        with patch.object(indexer, 'request_json', return_value=(500, None, None)), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            total = indexer.crawl_once()
        self.assertEqual(total, 0)

    def test_drops_private_rows_and_retries_after_429(self):
        pages = [
            (429, None, None),
            (200, [
                {'id': 'org/public', 'private': False},
                {'id': 'org/secret', 'private': True},
                {'id': 'nopath'},
            ], None),
        ]

        def fake_request(_url, _token):
            return pages.pop(0)

        with patch.object(indexer, 'request_json', side_effect=fake_request), \
             patch.object(indexer, 'tokens', return_value=['hf_test']):
            total = indexer.crawl_once()
        conn = db.connect(self.db_path)
        ids = [row['id'] for row in conn.execute('SELECT id FROM models')]
        conn.close()
        self.assertEqual(total, 1)
        self.assertEqual(ids, ['org/public'])
