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

export const env = {
	databaseUrl: required(
		Bun.env.DATABASE_URL,
		"DATABASE_URL",
	),
	chaingraphUrl: required(
		Bun.env.CHAINGRAPH_URL,
		"CHAINGRAPH_URL",
	),
	chaingraphNetworkRegex: required(
		Bun.env.CHAINGRAPH_NETWORK_REGEX,
		"CHAINGRAPH_NETWORK_REGEX",
	),
	confirmations: numberWithDefault(Bun.env.CONFIRMATIONS, 6),
	startHeight: numberWithDefault(Bun.env.START_HEIGHT, 792772),
	ingestConcurrency: numberWithDefault(Bun.env.INGEST_CONCURRENCY, 10),
};
