/**
 * Deterministic product type alias/plural normalization.
 * Conservative table + broad category containment (e.g. apparel ⊃ sweatshirt).
 * No fuzzy matching. No arbitrary substring matching.
 */

const PRODUCT_TYPE_ALIASES: Record<string, string> = {
  sneaker: "shoe",
  sneakers: "shoe",
  trainers: "shoe",
  shoes: "shoe",
  "running shoe": "shoe",
  "running shoes": "shoe",
  "dress shoe": "shoe",
  handbag: "bag",
  handbags: "bag",
  purse: "bag",
  backpack: "bag",
  wallets: "wallet",
  "t-shirt": "shirt",
  tshirt: "shirt",
  tee: "shirt",
  "t shirt": "shirt",
  jumper: "sweater",
  pullover: "sweater",
};

/**
 * Broad Shopify-style categories → specific vision types they may contain.
 * Listing "Apparel" + vision "sweatshirt" is compatible (not a MISMATCH).
 */
const CATEGORY_MEMBERS: Record<string, readonly string[]> = {
  apparel: [
    "shirt",
    "sweatshirt",
    "hoodie",
    "sweater",
    "jacket",
    "coat",
    "pants",
    "jeans",
    "shorts",
    "skirt",
    "dress",
    "top",
    "blouse",
    "tank",
    "vest",
    "cardigan",
    "clothing",
  ],
  clothing: [
    "shirt",
    "sweatshirt",
    "hoodie",
    "sweater",
    "jacket",
    "coat",
    "pants",
    "jeans",
    "shorts",
    "skirt",
    "dress",
    "top",
    "blouse",
    "tank",
    "vest",
    "cardigan",
    "apparel",
  ],
  clothes: [
    "shirt",
    "sweatshirt",
    "hoodie",
    "sweater",
    "jacket",
    "coat",
    "pants",
    "jeans",
    "shorts",
    "skirt",
    "dress",
    "top",
    "blouse",
    "apparel",
    "clothing",
  ],
  footwear: ["shoe", "sneaker", "boot", "sandal", "slipper", "loafer"],
  accessories: ["wallet", "bag", "belt", "hat", "scarf", "glove", "cap"],
};

/**
 * Lowercase + trim + conservative alias table.
 * Unknown types pass through unchanged.
 */
export function normalizeProductType(raw: string): string {
  const key = raw.toLowerCase().trim();
  return PRODUCT_TYPE_ALIASES[key] ?? key;
}

function isCategoryMember(category: string, specific: string): boolean {
  const members = CATEGORY_MEMBERS[category];
  if (!members) return false;
  return members.includes(specific);
}

/**
 * Exact equality after normalization, OR compatible category↔specific.
 * Examples:
 *   apparel ↔ sweatshirt → true
 *   sneaker ↔ shoe → true (alias)
 *   wallet ↔ shoe → false
 */
export function productTypesMatch(a: string, b: string): boolean {
  const na = normalizeProductType(a);
  const nb = normalizeProductType(b);
  if (na === nb) return true;
  // Either side may be the broad category
  if (isCategoryMember(na, nb) || isCategoryMember(nb, na)) return true;
  return false;
}
