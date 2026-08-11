# Mutation Safety Checklist (GraphiQL)

Do this **before** relying on Apply Fix in the UI.

## 1. Create Product B

In Shopify Admin → Products:

| Field | Value |
|-------|-------|
| Title | Red Leather Wallet |
| Type | Wallet |
| Option | Color = Red |
| Image | Clearly **black** wallet |

## 2. Record GIDs

```graphql
{
  products(first: 5, query: "Red Leather Wallet") {
    edges {
      node {
        id
        title
        options {
          id
          name
          optionValues { id name }
        }
      }
    }
  }
}
```

Write down:

- `productId` = `gid://shopify/Product/...`
- `optionId` = Color option id
- `optionValueId` = Red value id

## 3. Test mutation

```graphql
mutation TestOptionUpdate(
  $productId: ID!
  $option: OptionUpdateInput!
  $optionValuesToUpdate: [OptionValueUpdateInput!]
) {
  productOptionUpdate(
    productId: $productId
    option: $option
    optionValuesToUpdate: $optionValuesToUpdate
  ) {
    userErrors { field message code }
    product {
      id
      options {
        id
        name
        optionValues { id name }
      }
    }
  }
}
```

Variables:

```json
{
  "productId": "gid://shopify/Product/YOUR_ID",
  "option": { "id": "gid://shopify/ProductOption/YOUR_OPTION_ID" },
  "optionValuesToUpdate": [
    { "id": "gid://shopify/ProductOptionValue/YOUR_VALUE_ID", "name": "Black" }
  ]
}
```

## 4. Verify + reset

1. Confirm `userErrors` is empty and option value is `Black`
2. Confirm in Admin UI
3. Run the same mutation with `"name": "Red"` to reset for the demo

## Fallback

If `productOptionUpdate` fails, try `productVariantsBulkUpdate` with the variant id and `optionValues: [{ name: "Black", optionName: "Color" }]`.
