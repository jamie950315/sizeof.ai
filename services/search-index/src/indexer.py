import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from .db import connect, count_models, get_meta, set_meta, upsert_models

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


class TokenCursor:
    def __init__(self, pool: list[str]):
        self.pool = pool
        self.index = 0

    def next(self) -> str | None:
        if not self.pool:
            return None
        token = self.pool[self.index % len(self.pool)]
        self.index += 1
        return token


def crawl_pages(
    db,
    token_cursor: TokenCursor,
    sort: str,
    *,
    max_pages: int | None = None,
    new_id_stagnant: int | None = None,
    count_stagnant: int | None = None,
    min_total_for_count_stagnant: int = 100_000,
) -> dict:
    cursor = None
    page = 0
    accepted = 0
    inserted_total = 0
    seen_cursors: set[str] = set()
    stagnant_new = 0
    stagnant_count = 0
    last_total = count_models(db)
    stop_reason = 'end'
    while True:
        url = f'https://huggingface.co/api/models?limit=1000&sort={sort}&direction=-1'
        if cursor:
            url += '&cursor=' + urllib.parse.quote(cursor)
        status, body, link = request_json(url, token_cursor.next())
        if status == 429:
            time.sleep(20)
            continue
        if status != 200 or not isinstance(body, list):
            print(json.dumps({'message': 'page failed', 'sort': sort, 'status': status, 'page': page}), flush=True)
            time.sleep(5)
            if page == 0:
                stop_reason = 'error'
                break
            continue
        rows = [row for item in body if isinstance(item, dict) for row in [normalize(item)] if row]
        inserted = 0
        if rows:
            inserted, _updated = upsert_models(db, rows)
            accepted += len(rows)
            inserted_total += inserted
        page += 1
        current_total = last_total + inserted
        if inserted == 0:
            stagnant_new += 1
            stagnant_count += 1
        else:
            stagnant_new = 0
            stagnant_count = 0
            last_total = current_total
        if page % 10 == 0:
            set_meta(db, 'updated_at', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
            print(json.dumps({
                'message': 'indexed',
                'sort': sort,
                'page': page,
                'models': current_total,
                'inserted': inserted_total,
            }), flush=True)
        next_page = next_cursor(link)
        stop_count = (
            count_stagnant is not None
            and last_total > min_total_for_count_stagnant
            and stagnant_count >= count_stagnant
        )
        stop_new = new_id_stagnant is not None and stagnant_new >= new_id_stagnant
        stop_max = max_pages is not None and page >= max_pages
        if not next_page or not body:
            stop_reason = 'end'
        elif next_page in seen_cursors:
            stop_reason = 'repeat'
        elif stop_count:
            stop_reason = 'count_stagnant'
        elif stop_new:
            stop_reason = 'new_stagnant'
        elif stop_max:
            stop_reason = 'max_pages'
        else:
            seen_cursors.add(next_page)
            cursor = next_page
            continue
        break
    return {
        'sort': sort,
        'pages': page,
        'accepted': accepted,
        'inserted': inserted_total,
        'complete': stop_reason in ('end', 'repeat'),
        'stop': stop_reason,
    }


BACKFILL_SORTS = ('downloads', 'createdAt', 'lastModified')
FULL_BACKFILL_MAX_PAGES = 10_000
META_FULL_BACKFILL = 'full_backfill_done'


def crawl_once() -> int:
    pool = tokens()
    db = connect(DB_PATH)
    token_cursor = TokenCursor(pool)
    force = os.environ.get('SIZEOF_SEARCH_FULL_BACKFILL', '').strip().lower() in ('1', 'true', 'yes')
    backfill_done = get_meta(db, META_FULL_BACKFILL) == 'true' and not force
    passes: dict[str, dict] = {}
    if not backfill_done:
        complete = True
        for sort in BACKFILL_SORTS:
            result = crawl_pages(db, token_cursor, sort, max_pages=FULL_BACKFILL_MAX_PAGES)
            passes[sort] = result
            complete = complete and bool(result.get('complete'))
        if complete:
            set_meta(db, META_FULL_BACKFILL, 'true')
        print(json.dumps({'message': 'full backfill', 'complete': complete, 'passes': {key: value['inserted'] for key, value in passes.items()}}), flush=True)
    else:
        passes['downloads'] = crawl_pages(db, token_cursor, 'downloads', max_pages=30)
        passes['createdAt'] = crawl_pages(db, token_cursor, 'createdAt', new_id_stagnant=5)
    set_meta(db, 'updated_at', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    total = count_models(db)
    db.close()
    print(json.dumps({
        'message': 'crawl complete',
        'mode': 'refresh' if backfill_done else 'backfill',
        'passes': passes,
        'total': total,
    }), flush=True)
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
