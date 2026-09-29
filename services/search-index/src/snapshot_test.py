import gzip
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from .db import connect, set_meta, upsert_models
from .indexer import normalize
from .snapshot import file_sha256, publish_snapshot


class SnapshotTests(unittest.TestCase):
    def test_verified_snapshot_and_latest_previous_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'models.sqlite'
            db = connect(str(path))
            generations = []
            for index in range(3):
                upsert_models(db, [normalize({'id': f'org/model-{index}'})])
                set_meta(db, 'updated_at', f'2026-09-08T00:00:0{index}Z')
                manifest = publish_snapshot(str(path))
                generations.append(manifest['file'])
                archive = Path(directory) / manifest['file']
                self.assertEqual(file_sha256(archive), manifest['sha256'])
                self.assertEqual(manifest['models'], index + 1)
                self.assertEqual(json.loads((Path(directory) / 'snapshot.json').read_text()), manifest)
                restored = Path(directory) / 'restored.sqlite'
                restored.write_bytes(gzip.decompress(archive.read_bytes()))
                self.assertEqual(file_sha256(restored), manifest['databaseSha256'])
                published_database = Path(directory) / f"snapshot-{manifest['generation']}.sqlite"
                self.assertEqual(file_sha256(published_database), manifest['databaseSha256'])
                self.assertEqual(published_database.stat().st_size, manifest['databaseBytes'])
                with sqlite3.connect(restored) as copy:
                    self.assertEqual(copy.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                    self.assertEqual(copy.execute('SELECT COUNT(*) FROM models').fetchone()[0], index + 1)
            self.assertFalse((Path(directory) / generations[0]).exists())
            self.assertFalse((Path(directory) / generations[0].removesuffix('.gz')).exists())
            self.assertTrue((Path(directory) / generations[1]).exists())
            self.assertTrue((Path(directory) / generations[2]).exists())
            db.close()

    def test_empty_snapshot_does_not_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'models.sqlite'
            db = connect(str(path))
            with self.assertRaises(RuntimeError):
                publish_snapshot(str(path))
            self.assertFalse((Path(directory) / 'snapshot.json').exists())
            db.close()
