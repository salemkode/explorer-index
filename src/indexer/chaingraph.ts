import type { TadaDocumentNode } from "gql.tada";
import { print } from "graphql";
import { env } from "../config/env";
import type { ResultOf, VariablesOf } from "../graphql";

type GraphQLResponse<T> = {
	data?: T;
	errors?: Array<{ message: string }>;
};

export const fetchGraphQL = async <
	TDocument extends TadaDocumentNode<any, any>,
>(
	document: TDocument,
	variables?: VariablesOf<TDocument>,
) => {
	const response = await fetch(env.chaingraphUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			query: print(document),
			variables: variables ?? {},
		}),
	});

	if (!response.ok) {
		throw new Error(`Chaingraph request failed: ${response.status}`);
	}

	const payload = (await response.json()) as GraphQLResponse<
		ResultOf<TDocument>
	>;

	if (payload.errors?.length) {
		throw new Error(payload.errors[0]?.message ?? "Chaingraph error");
	}

	if (!payload.data) {
		throw new Error("Chaingraph response missing data");
	}

	return payload.data;
};
