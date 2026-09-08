# sizeof.ai model-name search index

This service keeps a public Hugging Face model-name index on the Osaka and San Jose VPS hosts. The Cloudflare Worker races both hosts and uses the first successful response.

It stores names, owners, downloads, likes, task, and gated flags only. Architecture and VRAM estimates stay on the existing model API.

Osaka is the only crawler and publishes a verified, immutable SQLite snapshot after a successful pass. Both search APIs serve completed generations; San Jose checks for a new generation every minute and verifies the download checksum, database integrity, count, and timestamp before a transactional import. Partial downloads keep the previous searchable generation. Health reports expose `generation` for comparison. Publication, transfer, and memory reload introduce a short convergence window; this is eventual consistency, not simultaneous switching.

The first completed crawl walks the Hub by downloads, created time, and last modified until each list ends. Later refreshes update the top 30,000 downloaded models and walk newest created models until five existing-only pages. This remains a discovery heuristic, not a guarantee that all renamed, newly public, deleted, or old modified repositories match the live Hub. Independent crawlers were replaced because mutable pagination, different run times, and unavailable/renamed repositories caused permanent divergence.

Transient page failures retry with bounded backoff; an unsuccessful pass retries after five minutes instead of six hours. Repeated cursors are failures, not proof of completeness. Only successful passes advance `updated_at` or publish. Successful cycles wait six hours before the next crawl.

## Run

```bash
# Osaka (bootstrap a snapshot before enabling snapshot-serving API)
docker compose --profile primary run --rm --no-deps indexer python -c \
  'from src.snapshot import publish_snapshot; publish_snapshot("/data/models.sqlite")'
docker compose -f docker-compose.yml -f compose.primary.yml --profile primary up -d --build api indexer

# San Jose: stop the former independent crawler before enabling replication
docker compose --profile primary stop indexer
docker compose -f docker-compose.yml -f compose.replica.yml --profile replica up -d --build api replica
```

Required environment: `SIZEOF_SEARCH_TOKEN`, `SIZEOF_SEARCH_HOST`, and approved Hugging Face credentials for the primary indexer. The replica uses only the shared search credential over HTTPS, not Hugging Face credentials. Snapshot endpoints require the same bearer authentication as search and never expose environment variables. Current primary URL is in `compose.replica.yml`; no Cloudflare Worker deployment is needed.

Snapshots contain only public model-list data. Latest and previous immutable snapshots are retained on the primary. Allow several GB of free space for backups and verified imports; replicas refuse imports without enough space. Source unavailability delays freshness but does not stop either site's existing searches. Promotion of a replica to crawler is manual, to avoid split-brain publication.

Stop with `docker compose down`.

## Test

From the repository root:

```bash
npm run test:search-index
```

Or from this directory:

```bash
python3 -m unittest discover -s src -p '*_test.py'
```
