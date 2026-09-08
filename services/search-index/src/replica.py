"""Consume completed snapshots; never crawl independently on a replica."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
import urllib.request

from .db import connect, get_meta, set_meta


def validate_manifest(manifest: dict) -> str:
    generation = manifest.get('generation', '')
    if not isinstance(generation, str) or not re.fullmatch(r'[a-f0-9]{64}', generation):
        raise ValueError('Invalid snapshot generation')
    if manifest.get('sha256') != generation:
        raise ValueError('Invalid snapshot checksum')
    for key in ('bytes', 'databaseBytes', 'models'):
        if type(manifest.get(key)) is not int or manifest[key] <= 0:
            raise ValueError('Invalid snapshot size/count')
    if manifest['databaseBytes'] > 8 * 1024**3 or manifest['bytes'] > 4 * 1024**3:
        raise ValueError('Snapshot exceeds safety limit')
    if not isinstance(manifest.get('updatedAt'), str):
        raise ValueError('Invalid snapshot timestamp')
    return generation


def install_snapshot(archive: Path, manifest: dict, db_path: str) -> None:
    generation = validate_manifest(manifest)
    if archive.stat().st_size != manifest['bytes']:
        raise ValueError('Snapshot download size mismatch')
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != generation:
            raise ValueError('Snapshot checksum mismatch')
    with tempfile.TemporaryDirectory(dir=Path(db_path).parent, prefix='.replica-') as tmp:
        unpacked = Path(tmp) / 'models.sqlite'
        size = 0
        with gzip.open(archive, 'rb') as source, unpacked.open('wb') as target:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > manifest['databaseBytes']:
                    raise ValueError('Snapshot expanded beyond declared size')
                target.write(chunk)
        if size != manifest['databaseBytes']:
            raise ValueError('Snapshot database size mismatch')
        source = sqlite3.connect(unpacked)
        try:
            if source.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('Snapshot database failed integrity check')
            if source.execute('SELECT count(*) FROM models').fetchone()[0] != manifest['models']:
                raise ValueError('Snapshot model count mismatch')
            timestamp = source.execute("SELECT value FROM meta WHERE key='updated_at'").fetchone()
            if timestamp is None or timestamp[0] != manifest['updatedAt']:
                raise ValueError('Snapshot timestamp mismatch')
            # Validate every column the search server needs before replacing its data.
            source.execute('SELECT id,owner,name,downloads,likes,task,trending,gated FROM models LIMIT 1')
            set_meta(source, 'snapshot_generation', generation)
            target = connect(db_path)
            try:
                # SQLite backup replaces the database transactionally, including WAL readers.
                source.backup(target)
            finally:
                target.close()
        finally:
            source.close()


def sync_once(source_url: str, token: str, db_path: str) -> bool:
    if not source_url.startswith('https://') or not token:
        raise ValueError('HTTPS source and search credential required')
    headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json',
               'User-Agent': 'sizeof.ai-search-replica/1.0 (+https://sizeof.ai)'}
    def request(path):
        return urllib.request.urlopen(urllib.request.Request(source_url.rstrip('/') + path, headers=headers), timeout=60)
    with request('/snapshot') as response:
        manifest = json.loads(response.read(65536))
    generation = validate_manifest(manifest)
    db = connect(db_path)
    try:
        if get_meta(db, 'snapshot_generation') == generation:
            return False
    finally:
        db.close()
    parent = Path(db_path).parent
    if shutil.disk_usage(parent).free < manifest['bytes'] + 3 * manifest['databaseBytes']:
        raise OSError('Insufficient free space for verified snapshot import')
    with tempfile.TemporaryDirectory(dir=parent, prefix='.download-') as tmp:
        archive = Path(tmp) / 'snapshot.gz'
        with request(f'/snapshot/{generation}.sqlite.gz') as response, archive.open('wb') as target:
            downloaded = 0
            while chunk := response.read(1024 * 1024):
                downloaded += len(chunk)
                if downloaded > manifest['bytes']:
                    raise ValueError('Download exceeds declared size')
                target.write(chunk)
        install_snapshot(archive, manifest, db_path)
    print(json.dumps({'message': 'replica synchronized', 'generation': generation,
                      'models': manifest['models'], 'updatedAt': manifest['updatedAt']}), flush=True)
    return True


def main():
    while True:
        try:
            sync_once(os.environ['SIZEOF_SEARCH_PRIMARY_URL'], os.environ['SIZEOF_SEARCH_TOKEN'],
                      os.environ.get('SIZEOF_SEARCH_DB', '/data/models.sqlite'))
        except Exception as error:
            # Do not log URLs or headers containing credentials.
            print(json.dumps({'message': 'replica sync failed', 'errorType': type(error).__name__}), flush=True)
        time.sleep(60)


if __name__ == '__main__':
    main()
