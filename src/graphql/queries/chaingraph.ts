import { graphql } from "../index";

export const GetTipHeight = graphql(`
  query GetTipHeight($network: String) {
    block(
      limit: 1
      order_by: { height: desc }
      where: { accepted_by: { node: { name: { _regex: $network } } } }
    ) {
      height
      hash
    }
  }
`);

export const GetBlockByHeight = graphql(`
  query GetBlockByHeight(
    $network: String
    $height: bigint
    $limitTxs: Int
    $offsetTxs: Int
  ) {
    block(
      limit: 1
      order_by: { height: desc }
      where: {
        accepted_by: { node: { name: { _regex: $network } } }
        height: { _eq: $height }
      }
    ) {
      height
      hash
      previous_block_hash
      timestamp
      transaction_count
      input_count
      output_count
      transactions(
        limit: $limitTxs
        offset: $offsetTxs
        order_by: { transaction_index: asc }
      ) {
        transaction_index
        transaction {
          hash
          is_coinbase
          inputs {
            input_index
            sequence_number
            outpoint_index
            outpoint_transaction_hash
          }
          outputs {
            output_index
            value_satoshis
            locking_bytecode
            token_category
            fungible_token_amount
            nonfungible_token_capability
            nonfungible_token_commitment
          }
        }
      }
    }
  }
`);
