# explorer-index

## Quickstart

```bash
bun install
docker compose up -d
```

Create a `.env` with:

```env
DATABASE_URL=postgresql://explorer:explorer@localhost:5432/explorer_index
CHAINGRAPH_URL=https://your-chaingraph-url/graphql
CHAINGRAPH_NETWORK_REGEX=mainnet
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
