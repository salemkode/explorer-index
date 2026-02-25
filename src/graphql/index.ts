import { initGraphQLTada } from "gql.tada";
import type { introspection } from "../graphql-env.d.ts";

export const graphql = initGraphQLTada<{
	introspection: introspection;
	scalars: {
		bigint: string;
		bytea: string;
		_text: string;
		enum_nonfungible_token_capability: string;
		timestamp: string;
	};
}>();

export type { FragmentOf, ResultOf, VariablesOf } from "gql.tada";
export { readFragment } from "gql.tada";
