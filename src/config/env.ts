const required = (value: string | undefined, name: string) => {
	if (!value) {
		throw new Error(`Missing required env var: ${name}`);
	}
	return value;
};

const numberWithDefault = (value: string | undefined, fallback: number) => {
	const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
	return Number.isNaN(parsed) ? fallback : parsed;
};

const booleanWithDefault = (value: string | undefined, fallback: boolean) => {
	if (!value) return fallback;
	return ["1", "true", "yes", "y"].includes(value.toLowerCase());
};

const stringWithDefault = (value: string | undefined, fallback: string) =>
	value && value.length > 0 ? value : fallback;

export const env = {
	databaseUrl: required(
		Bun.env.DATABASE_URL,
		"DATABASE_URL",
	),
	electrumHost: required(
		Bun.env.ELECTRUM_HOST,
		"ELECTRUM_HOST",
	),
	electrumPort: numberWithDefault(Bun.env.ELECTRUM_PORT, 50004),
	electrumTls: booleanWithDefault(Bun.env.ELECTRUM_TLS, true),
	electrumTimeoutMs: numberWithDefault(Bun.env.ELECTRUM_TIMEOUT_MS, 30_000),
	electrumKeepAliveMs: numberWithDefault(
		Bun.env.ELECTRUM_KEEP_ALIVE_MS,
		30_000,
	),
	electrumNetwork: stringWithDefault(Bun.env.ELECTRUM_NETWORK, "mainnet"),
	confirmations: numberWithDefault(Bun.env.CONFIRMATIONS, 6),
	startHeight: numberWithDefault(Bun.env.START_HEIGHT, 792772),
	ingestConcurrency: numberWithDefault(Bun.env.INGEST_CONCURRENCY, 10),
};
