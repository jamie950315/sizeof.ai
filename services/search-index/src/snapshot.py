"""Publish verified, immutable SQLite snapshots for search replicas."""

import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def publish_snapshot(db_path: str) -> dict:
    directory = Path(db_path).parent
    manifest_path = directory / 'snapshot.json'
    previous = None
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text()).get('generation')
    with tempfile.TemporaryDirectory(prefix='.snapshot-', dir=directory) as temporary:
        backup_path = Path(temporary) / 'models.sqlite'
        source = sqlite3.connect(f'{Path(db_path).resolve().as_uri()}?mode=ro', uri=True)
        backup = sqlite3.connect(backup_path)
        try:
            source.backup(backup)
            backup.execute('PRAGMA journal_mode=DELETE')
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Snapshot integrity validation failed')
            models = backup.execute('SELECT COUNT(*) FROM models').fetchone()[0]
            updated = backup.execute("SELECT value FROM meta WHERE key='updated_at'").fetchone()
            if models <= 0 or updated is None:
                raise RuntimeError('Cannot publish an empty or undated snapshot')
        finally:
            backup.close()
            source.close()
        database_hash = file_sha256(backup_path)
        compressed_path = Path(temporary) / 'snapshot.sqlite.gz'
        with backup_path.open('rb') as source_file, compressed_path.open('wb') as target:
            with gzip.GzipFile(filename='', mode='wb', fileobj=target, mtime=0, compresslevel=3) as compressed:
                shutil.copyfileobj(source_file, compressed, length=1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        checksum = file_sha256(compressed_path)
        filename = f'snapshot-{checksum}.sqlite.gz'
        manifest = {
            'generation': checksum, 'sha256': checksum,
            'databaseSha256': database_hash, 'models': models,
            'updatedAt': updated[0], 'file': filename,
            'bytes': compressed_path.stat().st_size,
            'databaseBytes': backup_path.stat().st_size,
        }
        database_filename = f'snapshot-{checksum}.sqlite'
        os.replace(backup_path, directory / database_filename)
        os.replace(compressed_path, directory / filename)
        staged_manifest = Path(temporary) / 'snapshot.json'
        with staged_manifest.open('w') as target:
            json.dump(manifest, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(staged_manifest, manifest_path)
        # Retain the previous generation so readers that just fetched its
        # manifest can still download it during publication.
        retained = {filename, database_filename, f'snapshot-{previous}.sqlite.gz',
                    f'snapshot-{previous}.sqlite'}
        for old in directory.glob('snapshot-*.sqlite*'):
            if old.name not in retained:
                old.unlink()
    return manifest
