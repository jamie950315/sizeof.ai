import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from .db import connect, count_models, set_meta, upsert_models

DB_PATH = os.environ.get('SIZEOF_SEARCH_DB', '/data/models.sqlite')
USER_AGENT = 'sizeof.ai-search-indexer/1.0 (+https://sizeof.ai)'


def tokens() -> list[str]:
    values = [
        os.environ.get('HF_TOKEN', ''),
        os.environ.get('HF_TOKEN_ENTERPRISE_1', ''),
        os.environ.get('HF_TOKEN_ENTERPRISE_2', ''),
        os.environ.get('HF_TOKEN_ENTERPRISE_3', ''),
        os.environ.get('HF_TOKEN_ENTERPRISE_4', ''),
    ]
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        token = value.strip()
        if token and token not in seen:
            seen.add(token)
            ordered.append(token)
    return ordered


def request_json(url: str, token: str | None) -> tuple[int, dict | list | None, str | None]:
    headers = {'Accept': 'application/json', 'User-Agent': USER_AGENT}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            body = json.loads(res.read().decode())
            link = res.headers.get('Link')
            return res.status, body, link
    except urllib.error.HTTPError as error:
        return error.code, None, None


def next_cursor(link: str | None) -> str | None:
    if not link:
        return None
    for part in link.split(','):
        if 'rel="next"' not in part and "rel=next" not in part:
            continue
        start = part.find('<')
        end = part.find('>')
        if start == -1 or end == -1:
            continue
        try:
            url = urllib.parse.urlparse(part[start + 1:end])
            return urllib.parse.parse_qs(url.query).get('cursor', [None])[0]
        except Exception:
            return None
    return None


def normalize(raw: dict) -> dict | None:
    ident = raw.get('id')
    if not isinstance(ident, str) or '/' not in ident:
        return None
    if raw.get('private') is True:
        return None
    owner, name = ident.split('/', 1)
    if not owner or not name:
        return None
    task = raw.get('pipeline_tag')
    return {
        'id': ident,
        'owner': owner,
        'name': name,
        'id_lower': ident.lower(),
        'owner_lower': owner.lower(),
        'name_lower': name.lower(),
        'downloads': int(raw['downloads']) if isinstance(raw.get('downloads'), int) else 0,
        'likes': int(raw['likes']) if isinstance(raw.get('likes'), int) else 0,
        'task': task if isinstance(task, str) else None,
        'trending': int(raw['trendingScore']) if isinstance(raw.get('trendingScore'), int) else 0,
        'gated': 1 if raw.get('gated') else 0,
    }


def crawl_once() -> int:
    pool = tokens()
    db = connect(DB_PATH)
    cursor = None
    page = 0
    accepted = 0
    index = 0
    seen_cursors: set[str] = set()
    stagnant = 0
    last_total = count_models(db)
    while True:
        url = 'https://huggingface.co/api/models?limit=1000&sort=downloads&direction=-1'
        if cursor:
            url += '&cursor=' + urllib.parse.quote(cursor)
        token = pool[index % len(pool)] if pool else None
        index += 1
        status, body, link = request_json(url, token)
        if status == 429:
            time.sleep(20)
            continue
        if status != 200 or not isinstance(body, list):
            print(json.dumps({'message': 'page failed', 'status': status, 'page': page}), flush=True)
            time.sleep(5)
            if page == 0:
                break
            continue
        rows = [row for item in body if isinstance(item, dict) for row in [normalize(item)] if row]
        if rows:
            upsert_models(db, rows)
            accepted += len(rows)
        page += 1
        current_total = count_models(db)
        if current_total <= last_total:
            stagnant += 1
        else:
            stagnant = 0
            last_total = current_total
        if page % 10 == 0:
            set_meta(db, 'updated_at', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
            print(json.dumps({'message': 'indexed', 'page': page, 'models': current_total}), flush=True)
        cursor = next_cursor(link)
        if not cursor or not body or cursor in seen_cursors or last_total > 100000 and stagnant >= 5:
            break
        seen_cursors.add(cursor)
        time.sleep(0.05)
    set_meta(db, 'updated_at', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    total = count_models(db)
    db.close()
    print(json.dumps({'message': 'crawl complete', 'accepted': accepted, 'total': total}), flush=True)
    return total


def main() -> None:
    while True:
        try:
            crawl_once()
        except Exception as error:
            print(json.dumps({'message': 'crawl error', 'error': str(error)}), flush=True)
        time.sleep(6 * 60 * 60)


if __name__ == '__main__':
    main()
