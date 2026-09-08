import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .db import connect, get_meta, set_meta, upsert_models
from .indexer import normalize
from .replica import install_snapshot, sync_once, validate_manifest
from .snapshot import publish_snapshot
from . import server


class ReplicaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = str(self.root / 'primary.sqlite')
        self.target = str(self.root / 'replica.sqlite')
        db = connect(self.source)
        upsert_models(db, [normalize({'id': 'org/public'})])
        set_meta(db, 'updated_at', '2026-09-08T00:00:00Z')
        db.close()
        self.manifest = publish_snapshot(self.source)
        self.archive = self.root / self.manifest['file']

    def tearDown(self):
        self.tmp.cleanup()

    def test_import_replaces_full_contents_and_sets_generation(self):
        db = connect(self.target)
        upsert_models(db, [normalize({'id': 'org/old'})])
        db.close()
        install_snapshot(self.archive, self.manifest, self.target)
        db = connect(self.target)
        self.assertEqual([r[0] for r in db.execute('select id from models')], ['org/public'])
        self.assertEqual(get_meta(db, 'snapshot_generation'), self.manifest['generation'])
        db.close()

    def test_corrupt_archive_preserves_existing_database(self):
        db = connect(self.target)
        upsert_models(db, [normalize({'id': 'org/old'})])
        db.close()
        self.archive.write_bytes(b'broken')
        with self.assertRaises(ValueError):
            install_snapshot(self.archive, self.manifest, self.target)
        db = connect(self.target)
        self.assertEqual(db.execute('select id from models').fetchone()[0], 'org/old')
        db.close()

    def test_wrong_count_and_expansion_are_rejected(self):
        for field in ('models', 'databaseBytes'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                install_snapshot(self.archive, {**self.manifest, field: self.manifest[field]-1}, self.target)

    def test_manifest_rejects_paths_and_unbounded_sizes(self):
        for delta in ({'generation': '../bad'}, {'databaseBytes': 9*1024**3}, {'bytes': -1}):
            with self.assertRaises(ValueError):
                validate_manifest({**self.manifest, **delta})

    def test_same_generation_does_not_download_again(self):
        import io
        install_snapshot(self.archive, self.manifest, self.target)
        with patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(self.manifest).encode())) as request:
            self.assertFalse(sync_once('https://example.test', 'test', self.target))
            self.assertEqual(request.call_count, 1)

    def test_primary_serves_completed_snapshot_not_working_changes(self):
        db = connect(self.source)
        upsert_models(db, [normalize({'id': 'org/in-progress'})])
        db.close()
        old = dict(server.STATE)
        try:
            with patch.object(server, 'DB_PATH', self.source), patch.dict('os.environ', {'SIZEOF_SEARCH_SERVE_SNAPSHOT': 'true'}):
                server.reload_models()
                self.assertEqual(server.STATE['count'], 1)
                self.assertEqual(server.STATE['generation'], self.manifest['generation'])
                self.assertEqual(server.search('org/', '', '', 12, 0)[0][0]['id'], 'org/public')
        finally:
            server.STATE.update(old)
