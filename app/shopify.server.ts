import "@shopify/shopify-app-react-router/adapters/node";
import { setDefaultResultOrder } from "node:dns";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { loadGroqEnvFromDotenvFile } from "./lib/load-groq-env.server";

// Prefer .env Groq keys over a stale rate-limited shell GROQ_API_KEY.
loadGroqEnvFromDotenvFile();

// Windows often resolves myshopify.com to IPv6 first; broken IPv6 routes cause
// "GraphQL Client: fetch failed" with no HTTP response. Prefer IPv4.
try {
  setDefaultResultOrder("ipv4first");
} catch {
  /* Node < 16.13 — ignore */
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

// Wire DB-backed scan job runner → Admin API client per shop
import { configureJobAdminFactory, ensureJobPoller } from "./lib/jobs.server";

configureJobAdminFactory(async (shop: string) => {
  try {
    const { admin } = await unauthenticated.admin(shop);
    return admin;
  } catch {
    return null;
  }
});
ensureJobPoller();

