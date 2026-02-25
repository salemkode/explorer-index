CREATE TABLE "addresses" (
	"locking_bytecode" "bytea" PRIMARY KEY NOT NULL,
	"script_type" text NOT NULL,
	"hash160" "bytea",
	"cashaddr" text,
	"first_seen_height" bigint
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"height" bigint NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"previous_block_hash" "bytea" NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"transaction_count" integer,
	"input_count" integer,
	"output_count" integer
);
--> statement-breakpoint
CREATE TABLE "holder_balances" (
	"token_category" "bytea" NOT NULL,
	"locking_bytecode" "bytea" NOT NULL,
	"fungible_amount" numeric(38, 0) DEFAULT '0' NOT NULL,
	"nft_count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "holder_balances_token_category_locking_bytecode_pk" PRIMARY KEY("token_category","locking_bytecode")
);
--> statement-breakpoint
CREATE TABLE "indexed_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"chain" text NOT NULL,
	"confirmations" integer NOT NULL,
	"last_indexed_height" bigint DEFAULT 0 NOT NULL,
	"last_indexed_block_hash" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inputs" (
	"tx_hash" "bytea" NOT NULL,
	"input_index" integer NOT NULL,
	"block_height" bigint NOT NULL,
	"prev_tx_hash" "bytea" NOT NULL,
	"prev_output_index" integer NOT NULL,
	"sequence_number" bigint,
	CONSTRAINT "inputs_tx_hash_input_index_pk" PRIMARY KEY("tx_hash","input_index")
);
--> statement-breakpoint
CREATE TABLE "outputs" (
	"tx_hash" "bytea" NOT NULL,
	"output_index" integer NOT NULL,
	"block_height" bigint NOT NULL,
	"value_satoshis" bigint,
	"locking_bytecode" "bytea" NOT NULL,
	"token_category" "bytea",
	"fungible_amount" numeric(38, 0),
	"nonfungible_capability" text,
	"nonfungible_commitment" "bytea",
	CONSTRAINT "outputs_tx_hash_output_index_pk" PRIMARY KEY("tx_hash","output_index")
);
--> statement-breakpoint
CREATE TABLE "token_index_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_processed_height" bigint DEFAULT 0 NOT NULL,
	"last_processed_block_hash" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_utxos" (
	"tx_hash" "bytea" NOT NULL,
	"output_index" integer NOT NULL,
	"block_height" bigint NOT NULL,
	"locking_bytecode" "bytea" NOT NULL,
	"token_category" "bytea" NOT NULL,
	"fungible_amount" numeric(38, 0),
	"nonfungible_capability" text,
	"nonfungible_commitment" "bytea",
	CONSTRAINT "token_utxos_tx_hash_output_index_pk" PRIMARY KEY("tx_hash","output_index")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"tx_hash" "bytea" NOT NULL,
	"block_height" bigint NOT NULL,
	"tx_index" integer,
	CONSTRAINT "transactions_tx_hash_pk" PRIMARY KEY("tx_hash")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_height_unique" ON "blocks" USING btree ("height");--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_hash_unique" ON "blocks" USING btree ("block_hash");--> statement-breakpoint
CREATE INDEX "inputs_prev_outpoint_idx" ON "inputs" USING btree ("prev_tx_hash","prev_output_index");--> statement-breakpoint
CREATE INDEX "inputs_block_height_idx" ON "inputs" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "outputs_block_height_idx" ON "outputs" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "outputs_token_category_idx" ON "outputs" USING btree ("token_category");--> statement-breakpoint
CREATE INDEX "outputs_locking_bytecode_idx" ON "outputs" USING btree ("locking_bytecode");--> statement-breakpoint
CREATE INDEX "token_utxos_token_category_idx" ON "token_utxos" USING btree ("token_category");--> statement-breakpoint
CREATE INDEX "token_utxos_locking_bytecode_idx" ON "token_utxos" USING btree ("locking_bytecode");--> statement-breakpoint
CREATE INDEX "transactions_block_height_idx" ON "transactions" USING btree ("block_height");