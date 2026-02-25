import {
	bigint,
	customType,
	index,
	integer,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: string; driverData: string }>({
	dataType() {
		return "bytea";
	},
});

export const indexedState = pgTable("indexed_state", {
	id: integer("id").primaryKey().default(1),
	chain: text("chain").notNull(),
	confirmations: integer("confirmations").notNull(),
	lastIndexedHeight: bigint("last_indexed_height", { mode: "bigint" })
		.notNull()
		.default(sql`0`),
	lastIndexedBlockHash: bytea("last_indexed_block_hash"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const blocks = pgTable(
	"blocks",
	{
		height: bigint("height", { mode: "bigint" }).notNull(),
		blockHash: bytea("block_hash").notNull(),
		previousBlockHash: bytea("previous_block_hash").notNull(),
		timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
		transactionCount: integer("transaction_count"),
		inputCount: integer("input_count"),
		outputCount: integer("output_count"),
	},
	(table) => ({
		heightUnique: uniqueIndex("blocks_height_unique").on(table.height),
		hashUnique: uniqueIndex("blocks_hash_unique").on(table.blockHash),
	}),
);

export const transactions = pgTable(
	"transactions",
	{
		txHash: bytea("tx_hash").notNull(),
		blockHeight: bigint("block_height", { mode: "bigint" }).notNull(),
		txIndex: integer("tx_index"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.txHash] }),
		blockHeightIdx: index("transactions_block_height_idx").on(
			table.blockHeight,
		),
	}),
);

export const outputs = pgTable(
	"outputs",
	{
		txHash: bytea("tx_hash").notNull(),
		outputIndex: integer("output_index").notNull(),
		blockHeight: bigint("block_height", { mode: "bigint" }).notNull(),
		valueSatoshis: bigint("value_satoshis", { mode: "bigint" }),
		lockingBytecode: bytea("locking_bytecode").notNull(),
		tokenCategory: bytea("token_category"),
		fungibleAmount: numeric("fungible_amount", { precision: 38, scale: 0 }),
		nonfungibleCapability: text("nonfungible_capability"),
		nonfungibleCommitment: bytea("nonfungible_commitment"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.txHash, table.outputIndex] }),
		blockHeightIdx: index("outputs_block_height_idx").on(table.blockHeight),
		tokenCategoryIdx: index("outputs_token_category_idx").on(
			table.tokenCategory,
		),
		lockingBytecodeIdx: index("outputs_locking_bytecode_idx").on(
			table.lockingBytecode,
		),
	}),
);

export const inputs = pgTable(
	"inputs",
	{
		txHash: bytea("tx_hash").notNull(),
		inputIndex: integer("input_index").notNull(),
		blockHeight: bigint("block_height", { mode: "bigint" }).notNull(),
		prevTxHash: bytea("prev_tx_hash").notNull(),
		prevOutputIndex: bigint("prev_output_index", { mode: "bigint" }).notNull(),
		sequenceNumber: bigint("sequence_number", { mode: "bigint" }),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.txHash, table.inputIndex] }),
		prevOutpointIdx: index("inputs_prev_outpoint_idx").on(
			table.prevTxHash,
			table.prevOutputIndex,
		),
		blockHeightIdx: index("inputs_block_height_idx").on(table.blockHeight),
	}),
);

export const tokenUtxos = pgTable(
	"token_utxos",
	{
		txHash: bytea("tx_hash").notNull(),
		outputIndex: integer("output_index").notNull(),
		blockHeight: bigint("block_height", { mode: "bigint" }).notNull(),
		lockingBytecode: bytea("locking_bytecode").notNull(),
		tokenCategory: bytea("token_category").notNull(),
		fungibleAmount: numeric("fungible_amount", { precision: 38, scale: 0 }),
		nonfungibleCapability: text("nonfungible_capability"),
		nonfungibleCommitment: bytea("nonfungible_commitment"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.txHash, table.outputIndex] }),
		tokenCategoryIdx: index("token_utxos_token_category_idx").on(
			table.tokenCategory,
		),
		lockingBytecodeIdx: index("token_utxos_locking_bytecode_idx").on(
			table.lockingBytecode,
		),
	}),
);

export const holderBalances = pgTable(
	"holder_balances",
	{
		tokenCategory: bytea("token_category").notNull(),
		lockingBytecode: bytea("locking_bytecode").notNull(),
		fungibleAmount: numeric("fungible_amount", { precision: 38, scale: 0 })
			.notNull()
			.default("0"),
	nftCount: bigint("nft_count", { mode: "bigint" })
		.notNull()
		.default(sql`0`),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.tokenCategory, table.lockingBytecode] }),
	}),
);

export const addresses = pgTable("addresses", {
	lockingBytecode: bytea("locking_bytecode").primaryKey(),
	scriptType: text("script_type").notNull(),
	hash160: bytea("hash160"),
	cashaddr: text("cashaddr"),
	firstSeenHeight: bigint("first_seen_height", { mode: "bigint" }),
});

export const tokenIndexState = pgTable("token_index_state", {
	id: integer("id").primaryKey().default(1),
	lastProcessedHeight: bigint("last_processed_height", { mode: "bigint" })
		.notNull()
		.default(sql`0`),
	lastProcessedBlockHash: bytea("last_processed_block_hash"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
