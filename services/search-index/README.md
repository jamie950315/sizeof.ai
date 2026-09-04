# sizeof.ai model-name search index

This service keeps a public Hugging Face model-name index on the Osaka and San Jose VPS hosts. The Cloudflare Worker races both hosts and uses the first successful response.

It stores names, owners, downloads, likes, task, and gated flags only. Architecture and VRAM estimates stay on the existing model API.

The first completed crawl walks the Hub by downloads, created time, and last modified until each list ends, so older names missed by one ordering can still be inserted. Later refreshes update the most downloaded models and then walk newest created models, including unpopular ones, until they meet names already in the index.

## Run

```bash
docker compose up -d --build
```

Required environment: `SIZEOF_SEARCH_TOKEN`, `SIZEOF_SEARCH_HOST`, and Hugging Face tokens for the indexer.

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

