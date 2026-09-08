# sizeof.ai model-name search index

This service keeps a public Hugging Face model-name index on the Osaka and San Jose VPS hosts. The Cloudflare Worker races both hosts and uses the first successful response.

It stores names, owners, downloads, likes, task, and gated flags only. Architecture and VRAM estimates stay on the existing model API.

Osaka is the only crawler and publishes a verified, immutable SQLite snapshot after a successful pass. Both search APIs serve completed generations; San Jose checks for a new generation every minute and verifies the download checksum, database integrity, count, and timestamp before a transactional import. Partial downloads keep the previous searchable generation. Health reports expose `generation` for comparison. Publication, transfer, and memory reload introduce a short convergence window; this is eventual consistency, not simultaneous switching.

The first completed crawl walks the Hub by downloads, created time, and last modified until each list ends. Later refreshes update the top 30,000 downloaded models and walk newest created models until five existing-only pages. This remains a discovery heuristic, not a guarantee that all renamed, newly public, deleted, or old modified repositories match the live Hub. Independent crawlers were replaced because mutable pagination, different run times, and unavailable/renamed repositories caused permanent divergence.

Transient page failures retry with bounded backoff; an unsuccessful pass retries after five minutes instead of six hours. Repeated cursors are failures, not proof of completeness. Only successful passes advance `updated_at` or publish. Successful cycles wait six hours before the next crawl.

Health returns HTTP 503 for an empty index, a failed memory reload, or a failed crawler/replica cycle. `ready` reports whether the last completed snapshot is still searchable; `syncHealthy` and `degraded` distinguish freshness failures from search unavailability. Shared local status records expose the failed stage, check time, and exception type without persisting request details or secrets. Successful refreshes clear the failure. Malformed upstream next-page links are errors, never evidence that a crawl finished. Search rejects malformed and out-of-range cursors instead of silently restarting pagination or scanning the entire list.

Index loading streams SQLite rows directly into model records to avoid keeping a second full row list in memory. A single popularity ordering populates all six search buckets instead of sorting and recomputing ranking keys in each bucket. A local synthetic 100,000-model check reduced index construction from 0.347 s to 0.178 s; real-host timings depend on the data and machine.

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

## San Jose public ingress

Testnet uses `https://sizeof-search-us.0ruka.dev`, served by the dedicated `sizeof-search-us` Cloudflare Tunnel (`a6b59d6b-b12a-4130-811e-0c3435a957b6`). Only A1-US should connect this tunnel. The API remains bound to loopback port 8788; search and snapshot endpoints still require the search bearer credential. No Hugging Face credentials are involved in the tunnel.

The checked-in `cloudflared.us.yml` and `cloudflared-sizeof-search.service` install to `/etc/cloudflared/sizeof-search-us.yml` and `/etc/systemd/system/cloudflared-sizeof-search.service`. Provision the tunnel-specific credential separately at `/etc/cloudflared/sizeof-search-us.json` (root-owned, mode 600); never commit it or copy account-wide certificates to this host. Metrics bind only to `127.0.0.1:20243`.

```bash
sudo cloudflared tunnel --config /etc/cloudflared/sizeof-search-us.yml ingress validate
sudo systemd-analyze verify /etc/systemd/system/cloudflared-sizeof-search.service
sudo systemctl enable --now cloudflared-sizeof-search
sudo systemctl status cloudflared-sizeof-search
```

Verify `/api/status` from the deployed testnet Worker, not only SSH: MagicDNS resolves the old Tailscale hostname to a private address inside the tailnet, which can hide public Funnel failure. In the incident, public Funnel IPs timed out before TCP connection while private requests succeeded. A separate DERP process owns wildcard port 443 and causes Tailscale listener warnings; it was not stopped or modified, and its role in the public timeout is unproven. The old Funnel configuration remains for independent investigation, but is not used by testnet. The dedicated tunnel does not restart or reconfigure the unrelated Mullvad-map tunnel.

## Test

From the repository root:

```bash
npm run test:search-index
```

Or from this directory:

```bash
python3 -m unittest discover -s src -p '*_test.py'
```
