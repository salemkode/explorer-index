import {
	binToHex,
	decodeTransaction,
	hash256,
	hexToBin,
	swapEndianness,
} from "@bitauth/libauth";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import {
	blocks,
	indexedState,
	nftBalances,
	tokenBalances,
	tokenInputs,
	tokenOutputs,
	tokenTransactions,
	tokenUtxos,
} from "../db/schema";
import {
	fetchBlockHeaderHex,
	fetchChainTip,
	fetchTransactionHex,
	fetchTransactionIdFromPosition,
	getElectrumClient,
} from "./electrum";

const toBigInt = (value: string | number | bigint) => BigInt(value);
const toOptionalBigInt = (value?: string | number | bigint | null) =>
	value == null ? null : BigInt(value);
const toAmountBigInt = (value?: string | number | bigint | null) =>
	value == null ? 0n : BigInt(value);
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

const toBytea = (value: string | Uint8Array | null | undefined) => {
	if (!value) return null;
	if (value instanceof Uint8Array) {
		return `\\x${binToHex(value)}`;
	}
	return value.startsWith("\\x") ? value : `\\x${value}`;
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
			chain: env.electrumNetwork,
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

type DecodedTransaction = Exclude<ReturnType<typeof decodeTransaction>, string>;

type BlockTransaction = {
	txHash: string;
	txIndex: number;
	transaction: DecodedTransaction;
	isCoinbase: boolean;
};

type BlockHeaderData = {
	height: bigint;
	hash: string;
	previousBlockHash: string;
	timestamp: Date;
	transactionCount: number;
	inputCount: number;
	outputCount: number;
};

const decodeBlockHeader = (headerHex: string) => {
	const headerBin = hexToBin(headerHex);
	if (headerBin.length !== 80) {
		throw new Error("Electrum returned an invalid block header");
	}
	const view = new DataView(
		headerBin.buffer,
		headerBin.byteOffset,
		headerBin.byteLength,
	);
	const timestamp = view.getUint32(68, true);
	const previousBlockHash = swapEndianness(
		binToHex(headerBin.slice(4, 36)),
	);
	const blockHash = swapEndianness(binToHex(hash256(headerBin)));
	return { timestamp, blockHash, previousBlockHash };
};

const isCoinbaseInput = (input: DecodedTransaction["inputs"][number]) => {
	const outpointHash = binToHex(input.outpointTransactionHash);
	return outpointHash === "00".repeat(32) && input.outpointIndex === 0xffffffff;
};

const isOutOfRangeError = (error: Error) =>
	/(out of range|tx_pos|position)/i.test(error.message);

const fetchBlockTransactionIds = async (height: number) => {
	const client = await getElectrumClient();
	const txIds: string[] = [];

	for (let position = 0; ; position += 1) {
		const response = await fetchTransactionIdFromPosition(
			client,
			height,
			position,
		);
		if (response instanceof Error) {
			if (isOutOfRangeError(response)) {
				break;
			}
			throw response;
		}

		txIds.push(response);
	}

	return txIds;
};

const fetchFullBlock = async (height: bigint) => {
	const client = await getElectrumClient();
	const headerHex = await fetchBlockHeaderHex(client, Number(height));
	const header = decodeBlockHeader(headerHex);
	const txIds = await fetchBlockTransactionIds(Number(height));
	const transactions: BlockTransaction[] = [];

	for (const [txIndex, txId] of txIds.entries()) {
		const txHex = await fetchTransactionHex(client, txId);
		const decoded = decodeTransaction(hexToBin(txHex));
		if (typeof decoded === "string") {
			throw new Error(`Failed to decode transaction ${txId}: ${decoded}`);
		}
		const txHash = toBytea(txId);
		if (!txHash) {
			throw new Error(`Invalid transaction hash returned: ${txId}`);
		}
		const isCoinbase =
			decoded.inputs.length === 1 && isCoinbaseInput(decoded.inputs[0]);
		transactions.push({
			txHash,
			txIndex,
			transaction: decoded,
			isCoinbase,
		});
	}

	const inputCount = transactions.reduce(
		(total, item) => total + item.transaction.inputs.length,
		0,
	);
	const outputCount = transactions.reduce(
		(total, item) => total + item.transaction.outputs.length,
		0,
	);

	const blockHash = toBytea(header.blockHash);
	const previousBlockHash = toBytea(header.previousBlockHash);
	if (!blockHash || !previousBlockHash) {
		throw new Error("Failed to parse block hashes");
	}

	return {
		block: {
			height,
			hash: blockHash,
			previousBlockHash,
			timestamp: new Date(header.timestamp * 1000),
			transactionCount: transactions.length,
			inputCount,
			outputCount,
		} satisfies BlockHeaderData,
		transactions,
	};
};

const persistBlock = async (
	block: BlockHeaderData,
	transactions: BlockTransaction[],
) => {
	await db.transaction(async (tx) => {
		await tx
			.insert(blocks)
			.values({
				height: block.height,
				blockHash: block.hash,
				previousBlockHash: block.previousBlockHash,
				timestamp: block.timestamp,
				transactionCount: block.transactionCount,
				inputCount: block.inputCount,
				outputCount: block.outputCount,
			})
			.onConflictDoNothing();

		const transactionMeta = new Map(
			transactions.map((item) => [
				item.txHash,
				{ txIndex: item.txIndex, isCoinbase: item.isCoinbase ? 1 : 0 },
			]),
		);

		const tokenTxMap = new Map<string, { txIndex: number | null; isCoinbase: number }>();
		const tokenOutputsRows = [] as Array<{
			txHash: string;
			outputIndex: number;
			blockHeight: bigint;
			lockingBytecode: string;
			tokenCategory: string;
			fungibleAmount: string | null;
			nonfungibleCapability: string | null;
			nonfungibleCommitment: string | null;
		}>;
		const rawInputs = [] as Array<{
			txHash: string;
			txIndex: number;
			inputIndex: number;
			blockHeight: bigint;
			prevTxHash: string;
			prevOutputIndex: number;
			sequenceNumber: bigint | null;
		}>;

		const fungibleDeltas = new Map<string, bigint>();
		const nftDeltas = new Map<string, bigint>();

		const addFungibleDelta = (
			tokenCategory: string,
			lockingBytecode: string,
			delta: bigint,
		) => {
			if (!delta) return;
			const key = `${tokenCategory}:${lockingBytecode}`;
			fungibleDeltas.set(key, (fungibleDeltas.get(key) ?? 0n) + delta);
		};

		const addNftDelta = (
			tokenCategory: string,
			lockingBytecode: string,
			delta: bigint,
		) => {
			if (!delta) return;
			const key = `${tokenCategory}:${lockingBytecode}`;
			nftDeltas.set(key, (nftDeltas.get(key) ?? 0n) + delta);
		};

		for (const item of transactions) {
			item.transaction.outputs.forEach(
				(
					output: DecodedTransaction["outputs"][number],
					outputIndex: number,
				) => {
				if (!output.token) return;

				const tokenCategory = toBytea(output.token.category);
				const lockingBytecode = toBytea(output.lockingBytecode);
				if (!tokenCategory || !lockingBytecode) {
					return;
				}

				const meta = transactionMeta.get(item.txHash);
				if (meta) {
					tokenTxMap.set(item.txHash, meta);
				}

				tokenOutputsRows.push({
					txHash: item.txHash,
					outputIndex,
					blockHeight: block.height,
					lockingBytecode,
					tokenCategory,
					fungibleAmount:
						output.token.amount === 0n
							? null
							: output.token.amount.toString(),
					nonfungibleCapability: output.token.nft?.capability ?? null,
					nonfungibleCommitment: output.token.nft?.commitment
						? toBytea(output.token.nft.commitment)
						: null,
				});

				addFungibleDelta(
					tokenCategory,
					lockingBytecode,
					output.token.amount,
				);
				if (output.token.nft) {
					addNftDelta(tokenCategory, lockingBytecode, 1n);
				}
			},
			);

			item.transaction.inputs.forEach(
				(
					input: DecodedTransaction["inputs"][number],
					inputIndex: number,
				) => {
				const prevTxHash = toBytea(binToHex(input.outpointTransactionHash));
				if (!prevTxHash) return;
				rawInputs.push({
					txHash: item.txHash,
					txIndex: item.txIndex,
					inputIndex,
					blockHeight: block.height,
					prevTxHash,
					prevOutputIndex: input.outpointIndex,
					sequenceNumber: toOptionalBigInt(input.sequenceNumber),
				});
			},
			);
		}

		if (tokenOutputsRows.length) {
			await insertBatched(tx, tokenOutputs, tokenOutputsRows);
			await insertBatched(tx, tokenUtxos, tokenOutputsRows);
		}

		const resolvedOutpoints = [] as Array<{
			txHash: string;
			outputIndex: number;
			lockingBytecode: string;
			tokenCategory: string;
			fungibleAmount: string | null;
			nonfungibleCapability: string | null;
			nonfungibleCommitment: string | null;
		}>;

		for (let i = 0; i < rawInputs.length; i += batchSize) {
			const chunk = rawInputs.slice(i, i + batchSize);
			const outpointConditions = chunk.map((item) =>
				and(
					eq(tokenUtxos.txHash, item.prevTxHash),
					eq(tokenUtxos.outputIndex, item.prevOutputIndex),
				),
			);

			if (!outpointConditions.length) continue;
			const rows = await tx
				.select()
				.from(tokenUtxos)
				.where(or(...outpointConditions));
			resolvedOutpoints.push(...rows);
		}

		const resolvedOutpointMap = new Map(
			resolvedOutpoints.map((row) => [
				`${row.txHash}:${row.outputIndex}`,
				row,
			]),
		);

		const tokenInputsRows = [] as Array<{
			txHash: string;
			inputIndex: number;
			blockHeight: bigint;
			prevTxHash: string;
			prevOutputIndex: bigint;
			lockingBytecode: string | null;
			tokenCategory: string | null;
			fungibleAmount: string | null;
			nonfungibleCapability: string | null;
			nonfungibleCommitment: string | null;
			sequenceNumber: bigint | null;
		}>;

		const spentOutpoints = [] as Array<{
			txHash: string;
			outputIndex: number;
		}>;

		for (const input of rawInputs) {
			const outpointKey = `${input.prevTxHash}:${input.prevOutputIndex}`;
			const outpoint = resolvedOutpointMap.get(outpointKey);
			if (!outpoint || outpoint.tokenCategory == null) {
				continue;
			}

			const meta = transactionMeta.get(input.txHash);
			if (meta) {
				tokenTxMap.set(input.txHash, meta);
			}

			tokenInputsRows.push({
				txHash: input.txHash,
				inputIndex: input.inputIndex,
				blockHeight: input.blockHeight,
				prevTxHash: input.prevTxHash,
				prevOutputIndex: toBigInt(input.prevOutputIndex),
				lockingBytecode: outpoint.lockingBytecode,
				tokenCategory: outpoint.tokenCategory,
				fungibleAmount: outpoint.fungibleAmount,
				nonfungibleCapability: outpoint.nonfungibleCapability,
				nonfungibleCommitment: outpoint.nonfungibleCommitment,
				sequenceNumber: input.sequenceNumber,
			});

			spentOutpoints.push({
				txHash: input.prevTxHash,
				outputIndex: input.prevOutputIndex,
			});

			if (outpoint.fungibleAmount != null) {
				addFungibleDelta(
					outpoint.tokenCategory,
					outpoint.lockingBytecode,
					-toAmountBigInt(outpoint.fungibleAmount),
				);
			}
			if (outpoint.nonfungibleCapability != null) {
				addNftDelta(outpoint.tokenCategory, outpoint.lockingBytecode, -1n);
			}
		}

		const tokenTxRows = Array.from(tokenTxMap.entries()).map(
			([txHash, meta]) => ({
				txHash,
				blockHeight: block.height,
				txIndex: meta.txIndex,
				blockTimestamp: block.timestamp,
				isCoinbase: meta.isCoinbase,
			}),
		);

		if (tokenTxRows.length) {
			await insertBatched(tx, tokenTransactions, tokenTxRows);
		}

		if (tokenInputsRows.length) {
			await insertBatched(tx, tokenInputs, tokenInputsRows);
		}

		for (let i = 0; i < spentOutpoints.length; i += batchSize) {
			const chunk = spentOutpoints.slice(i, i + batchSize);
			if (!chunk.length) continue;
			const deleteConditions = chunk.map((item) =>
				and(
					eq(tokenUtxos.txHash, item.txHash),
					eq(tokenUtxos.outputIndex, item.outputIndex),
				),
			);
			await tx.delete(tokenUtxos).where(or(...deleteConditions));
		}

		const tokenBalanceRows = Array.from(fungibleDeltas.entries())
			.map(([key, delta]) => {
				const [tokenCategory, lockingBytecode] = key.split(":");
				if (!tokenCategory || !lockingBytecode) return null;
				return {
					tokenCategory,
					lockingBytecode,
					balance: delta.toString(),
				};
			})
			.filter((row): row is {
				tokenCategory: string;
				lockingBytecode: string;
				balance: string;
			} => row != null);

		if (tokenBalanceRows.length) {
			await tx
				.insert(tokenBalances)
				.values(tokenBalanceRows)
				.onConflictDoUpdate({
					target: [tokenBalances.tokenCategory, tokenBalances.lockingBytecode],
					set: {
						balance: sql`${tokenBalances.balance} + excluded.balance`,
					},
				});
		}

		const nftBalanceRows = Array.from(nftDeltas.entries())
			.map(([key, delta]) => {
				const [tokenCategory, lockingBytecode] = key.split(":");
				if (!tokenCategory || !lockingBytecode) return null;
				return {
					tokenCategory,
					lockingBytecode,
					nftCount: delta,
				};
			})
			.filter((row): row is {
				tokenCategory: string;
				lockingBytecode: string;
				nftCount: bigint;
			} => row != null);

		if (nftBalanceRows.length) {
			await tx
				.insert(nftBalances)
				.values(nftBalanceRows)
				.onConflictDoUpdate({
					target: [nftBalances.tokenCategory, nftBalances.lockingBytecode],
					set: {
						nftCount: sql`${nftBalances.nftCount} + excluded.nft_count`,
					},
				});
		}

		await tx
			.update(indexedState)
			.set({
				lastIndexedHeight: block.height,
				lastIndexedBlockHash: block.hash,
				updatedAt: new Date(),
			})
			.where(eq(indexedState.id, 1));
	});
};

export const runIngestion = async () => {
	const client = await getElectrumClient();
	let state = await getOrInitState();
	console.log(
		JSON.stringify({
			msg: "indexer.start",
			lastIndexedHeight: state.lastIndexedHeight.toString(),
			lastIndexedBlockHash: state.lastIndexedBlockHash,
		}),
	);

	while (true) {
		const tip = await fetchChainTip(client);
		const tipHeight = toBigInt(tip.height);
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
			if (expectedPrevHash && block.previousBlockHash !== expectedPrevHash) {
				throw new Error(
					`Chain mismatch at height ${block.height}: expected prev ${expectedPrevHash}`,
				);
			}

			await persistBlock(block, blockTransactions);

			state = {
				...state,
				lastIndexedHeight: block.height,
				lastIndexedBlockHash: normalizeBytea(block.hash),
			};
			expectedPrevHash = state.lastIndexedBlockHash;

			console.log(
				JSON.stringify({
					msg: "indexer.block",
					height: block.height.toString(),
					hash: block.hash,
					transactions: blockTransactions.length,
					outputs: block.outputCount,
					inputs: block.inputCount,
				}),
			);
		}
	}
};
