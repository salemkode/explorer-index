import {
	fetchBlockHeaderFromBlockHeight,
	fetchCurrentChainTip,
	fetchTransaction,
	initializeElectrumClient,
} from "@electrum-cash/protocol";
import type { ElectrumClient, ElectrumProtocolEvents } from "@electrum-cash/protocol";
import { ElectrumWebSocket } from "@electrum-cash/web-socket";
import { env } from "../config/env";

let electrumClientPromise:
	| Promise<ElectrumClient<ElectrumProtocolEvents>>
	| null = null;

export const getElectrumClient = async () => {
	if (!electrumClientPromise) {
		const socket = new ElectrumWebSocket(
			env.electrumHost,
			env.electrumPort,
			env.electrumTls,
			env.electrumTimeoutMs,
		);
		electrumClientPromise = initializeElectrumClient(
			"explorer-index",
			socket,
			{
				sendKeepAliveIntervalInMilliSeconds: env.electrumKeepAliveMs,
			},
		);
	}

	return electrumClientPromise;
};

export const fetchChainTip = async (
	client: ElectrumClient<ElectrumProtocolEvents>,
) => fetchCurrentChainTip(client);

export const fetchBlockHeaderHex = async (
	client: ElectrumClient<ElectrumProtocolEvents>,
	height: number,
) => fetchBlockHeaderFromBlockHeight(client, height);

export const fetchTransactionHex = async (
	client: ElectrumClient<ElectrumProtocolEvents>,
	transactionHash: string,
) => {
	const response = await fetchTransaction(client, transactionHash);
	if (typeof response !== "string") {
		throw new Error("Electrum returned unexpected transaction payload");
	}
	return response;
};

export const fetchTransactionIdFromPosition = async (
	client: ElectrumClient<ElectrumProtocolEvents>,
	height: number,
	position: number,
) => {
	const response = await client.request(
		"blockchain.transaction.id_from_pos",
		height,
		position,
		false,
	);

	if (response instanceof Error) {
		return response;
	}

	if (typeof response === "string") {
		return response;
	}

	if (response && typeof response === "object" && "tx_hash" in response) {
		return String((response as { tx_hash: string }).tx_hash);
	}

	return new Error("Electrum returned unexpected id_from_pos payload");
};
