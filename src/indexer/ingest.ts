import { desc, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import {
	blocks,
	indexedState,
	inputs,
	outputs,
	transactions,
} from "../db/schema";
import { GetBlockByHeight, GetTipHeight } from "../graphql/queries/chaingraph";
import type { ResultOf } from "../graphql";
import { fetchGraphQL } from "./chaingraph";

const toBigInt = (value: string) => BigInt(value);
const toOptionalBigInt = (value?: string | null) =>
	value ? BigInt(value) : null;
const toDateFromSeconds = (value: string) =>
	new Date(Number.parseInt(value, 10) * 1000);
const normalizeBytea = (value: unknown) => {
	if (!value) return null;
	if (typeof value === "string") {
		return value.startsWith("\\x") ? value : `\\x${value}`;
	}
	if (value instanceof Uint8Array) {
		return `\\x${Buffer.from(value).toString("hex")}`;
	}
	return String(value);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const batchSize = 1000;
const ingestConcurrency = Math.max(1, Math.floor(env.ingestConcurrency));

const insertBatched = async <TRow>(
	tx: any,
	table: any,
	rows: TRow[],
) => {
	for (let i = 0; i < rows.length; i += batchSize) {
		const chunk = rows.slice(i, i + batchSize);
		if (!chunk.length) continue;
		await tx.insert(table).values(chunk).onConflictDoNothing();
	}
};

const getOrInitState = async () => {
	const existing = await db
		.select()
		.from(indexedState)
		.orderBy(desc(indexedState.id))
		.limit(1);

	if (existing[0]) {
		return {
			...existing[0],
			lastIndexedBlockHash: normalizeBytea(
				existing[0].lastIndexedBlockHash,
			),
		};
	}

	const inserted = await db
		.insert(indexedState)
		.values({
			chain: env.chaingraphNetworkRegex,
			confirmations: env.confirmations,
			lastIndexedHeight: BigInt(env.startHeight - 1),
		})
		.returning();

	if (!inserted[0]) {
		throw new Error("Failed to initialize indexed_state");
	}

	return {
		...inserted[0],
		lastIndexedBlockHash: normalizeBytea(
			inserted[0].lastIndexedBlockHash,
		),
	};
};

type BlockByHeightResult = ResultOf<typeof GetBlockByHeight>;
type BlockByHeight = BlockByHeightResult["block"][number];
type BlockTransaction = NonNullable<BlockByHeight>["transactions"][number];

const fetchFullBlock = async (height: bigint) => {
	const pageSize = 500;
	let offset = 0;
	let block: BlockByHeight | null = null;
	const transactionsCollected: BlockTransaction[] = [];

	while (true) {
		const response = await fetchGraphQL(GetBlockByHeight, {
			network: env.chaingraphNetworkRegex,
			height: height.toString(),
			limitTxs: pageSize,
			offsetTxs: offset,
		});

		const currentBlock = response.block.at(0);
		if (!currentBlock) {
			throw new Error(`Block not found at height ${height}`);
		}

		if (!block) {
			block = currentBlock;
		}

		const txPage = currentBlock.transactions ?? [];
		transactionsCollected.push(...txPage);

		if (txPage.length < pageSize) {
			break;
		}

		offset += pageSize;
	}

	return { block: block!, transactions: transactionsCollected };
};

const persistBlock = async (
	block: BlockByHeight,
	transactionsPage: BlockTransaction[],
) => {
	await db.transaction(async (tx) => {
		await tx
			.insert(blocks)
			.values({
				height: toBigInt(block.height),
				blockHash: block.hash,
				previousBlockHash: block.previous_block_hash,
				timestamp: toDateFromSeconds(block.timestamp),
				transactionCount: block.transaction_count
					? Number.parseInt(block.transaction_count, 10)
					: null,
				inputCount: block.input_count
					? Number.parseInt(block.input_count, 10)
					: null,
				outputCount: block.output_count
					? Number.parseInt(block.output_count, 10)
					: null,
			})
			.onConflictDoNothing();

		const txRows = transactionsPage.map((item) => ({
			txHash: item.transaction.hash,
			blockHeight: toBigInt(block.height),
			txIndex: item.transaction_index
				? Number.parseInt(item.transaction_index, 10)
				: null,
		}));

		if (txRows.length) {
			await insertBatched(tx, transactions, txRows);
		}

		const outputsRows = transactionsPage.flatMap((item) =>
			item.transaction.outputs.map((output) => ({
				txHash: item.transaction.hash,
				outputIndex: Number.parseInt(output.output_index, 10),
				blockHeight: toBigInt(block.height),
				valueSatoshis: toOptionalBigInt(output.value_satoshis),
				lockingBytecode: output.locking_bytecode,
				tokenCategory: output.token_category ?? null,
				fungibleAmount: output.fungible_token_amount ?? null,
				nonfungibleCapability: output.nonfungible_token_capability ?? null,
				nonfungibleCommitment: output.nonfungible_token_commitment ?? null,
			})),
		);

		if (outputsRows.length) {
			await insertBatched(tx, outputs, outputsRows);
		}

		const inputsRows = transactionsPage.flatMap((item) =>
			item.transaction.inputs.map((input) => ({
				txHash: item.transaction.hash,
				inputIndex: Number.parseInt(input.input_index, 10),
				blockHeight: toBigInt(block.height),
				prevTxHash: input.outpoint_transaction_hash,
				prevOutputIndex: toBigInt(input.outpoint_index),
				sequenceNumber: toOptionalBigInt(input.sequence_number),
			})),
		);

		if (inputsRows.length) {
			await insertBatched(tx, inputs, inputsRows);
		}

		await tx
			.update(indexedState)
			.set({
				lastIndexedHeight: toBigInt(block.height),
				lastIndexedBlockHash: block.hash,
				updatedAt: new Date(),
			})
			.where(eq(indexedState.id, 1));
	});
};

export const runIngestion = async () => {
	let state = await getOrInitState();

	while (true) {
		const tip = await fetchGraphQL(GetTipHeight, {
			network: env.chaingraphNetworkRegex,
		});

		const latestBlock = tip.block.at(0);
		if (!latestBlock) {
			throw new Error("Chaingraph returned no tip block");
		}

		const tipHeight = toBigInt(latestBlock.height);
		const safeTip = tipHeight - BigInt(env.confirmations);
		const nextHeight = state.lastIndexedHeight + 1n;

		if (nextHeight > safeTip) {
			console.log(
				JSON.stringify({
					msg: "indexer.wait",
					tipHeight: tipHeight.toString(),
					safeTip: safeTip.toString(),
					lastIndexedHeight: state.lastIndexedHeight.toString(),
				}),
			);
			await sleep(10_000);
			continue;
		}

		const remainingBlocks = safeTip - nextHeight + 1n;
		const maxBlocks = remainingBlocks > BigInt(Number.MAX_SAFE_INTEGER)
			? ingestConcurrency
			: Math.min(ingestConcurrency, Number(remainingBlocks));
		const heights = Array.from({ length: maxBlocks }, (_, index) =>
			nextHeight + BigInt(index),
		);

		const fetchedBlocks = await Promise.all(
			heights.map((height) => fetchFullBlock(height)),
		);

		let expectedPrevHash = state.lastIndexedBlockHash;
		for (const { block, transactions: blockTransactions } of fetchedBlocks) {
			if (expectedPrevHash && block.previous_block_hash !== expectedPrevHash) {
				throw new Error(
					`Chain mismatch at height ${block.height}: expected prev ${expectedPrevHash}`,
				);
			}

			await persistBlock(block, blockTransactions);

			state = {
				...state,
				lastIndexedHeight: toBigInt(block.height),
				lastIndexedBlockHash: normalizeBytea(block.hash),
			};
			expectedPrevHash = state.lastIndexedBlockHash;

			console.log(
				JSON.stringify({
					msg: "indexer.block",
					height: block.height,
					hash: block.hash,
					transactions: blockTransactions.length,
					outputs: blockTransactions.reduce(
						(total, item) => total + item.transaction.outputs.length,
						0,
					),
					inputs: blockTransactions.reduce(
						(total, item) => total + item.transaction.inputs.length,
						0,
					),
				}),
			);
		}
	}
};
