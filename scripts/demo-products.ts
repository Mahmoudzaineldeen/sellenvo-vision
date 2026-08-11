/**
 * Seed helper: creates three demo products via Admin GraphQL.
 *
 * Usage (after `shopify app dev` is running and you have an offline token):
 * Prefer creating products manually in Admin for the live demo — this script
 * documents the exact product shape expected by the Guardian.
 *
 * Product B (golden path):
 *   Title: Red Leather Wallet
 *   Product type: Wallet
 *   Option: Color = Red
 *   Image: clearly BLACK wallet photo
 *
 * Product A (match):
 *   Title: Red Leather Wallet (Correct)
 *   Color: Red + red wallet image
 *
 * Product C (uncertain):
 *   Title: Leather Wallet (Ambiguous)
 *   Color: Dark Green + poorly lit / cluttered image
 *
 * After creating Product B, record GIDs via GraphiQL:
 *
 * {
 *   products(first: 5, query: "Red Leather Wallet") {
 *     edges {
 *       node {
 *         id
 *         options {
 *           id
 *           name
 *           optionValues { id name }
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * TEST MUTATION in GraphiQL BEFORE coding (then reset Color back to Red):
 *
 * mutation($productId: ID!, $option: OptionUpdateInput!, $optionValuesToUpdate: [OptionValueUpdateInput!]) {
 *   productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $optionValuesToUpdate) {
 *     userErrors { field message code }
 *     product { options { name optionValues { id name } } }
 *   }
 * }
 *
 * Variables:
 * {
 *   "productId": "gid://shopify/Product/YOUR_ID",
 *   "option": { "id": "gid://shopify/ProductOption/YOUR_OPTION_ID" },
 *   "optionValuesToUpdate": [
 *     { "id": "gid://shopify/ProductOptionValue/YOUR_VALUE_ID", "name": "Black" }
 *   ]
 * }
 */

export const DEMO_PRODUCTS = [
  {
    key: "A",
    title: "Red Leather Wallet (Correct)",
    productType: "Wallet",
    color: "Red",
    note: "Use a clearly RED wallet image",
  },
  {
    key: "B",
    title: "Red Leather Wallet",
    productType: "Wallet",
    color: "Red",
    note: "GOLDEN PATH — use a clearly BLACK wallet image",
  },
  {
    key: "C",
    title: "Leather Wallet (Ambiguous)",
    productType: "Wallet",
    color: "Dark Green",
    note: "Use poorly lit / cluttered / partial image",
  },
] as const;
