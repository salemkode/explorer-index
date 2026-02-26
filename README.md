# explorer-index

## Quickstart

```bash
bun install
docker compose up -d
```

Create a `.env` with:

```env
DATABASE_URL=postgresql://explorer:explorer@localhost:5432/explorer_index
ELECTRUM_HOST=your-electrum-host
ELECTRUM_PORT=50004
ELECTRUM_TLS=true
ELECTRUM_NETWORK=mainnet
ELECTRUM_TIMEOUT_MS=30000
ELECTRUM_KEEP_ALIVE_MS=30000
CONFIRMATIONS=6
START_HEIGHT=792772
```

Run the indexer:

```bash
bun run index.ts
```

## Drizzle

Generate migrations:

```bash
bun run db:generate
```

Apply migrations:

```bash
bun run db:migrate
```
