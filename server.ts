import "dotenv/config";
import express from "express";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import axios from "axios";

admin.initializeApp();
const db = admin.firestore();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function validateEnv() {
  const missingCore = ["APP_URL"].filter((k) => !process.env[k]);
  if (missingCore.length) throw new Error(`Missing core env vars: ${missingCore.join(", ")}`);
  const missingEtsy = ["ETSY_CLIENT_ID", "ETSY_CLIENT_SECRET"].filter((k) => !process.env[k]);
  const missingSquare = ["SQUARE_CLIENT_ID", "SQUARE_CLIENT_SECRET"].filter((k) => !process.env[k]);
  if (missingEtsy.length) console.warn(`Etsy connect disabled. Missing: ${missingEtsy.join(", ")}`);
  if (missingSquare.length) console.warn(`Square connect disabled. Missing: ${missingSquare.join(", ")}`);
}

async function createOAuthState(provider: "etsy" | "square") {
  const token = crypto.randomBytes(24).toString("hex");
  await db.collection("oauth_states").doc(token).set({ provider, expiresAt: Date.now() + OAUTH_STATE_TTL_MS, createdAt: Date.now() });
  return token;
}

async function verifyOAuthState(provider: "etsy" | "square", state: string) {
  const ref = db.collection("oauth_states").doc(state);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() as any;
  if (data.provider !== provider || Date.now() > data.expiresAt) return false;
  await ref.delete();
  return true;
}

async function refreshEtsyToken() {
  const doc = await db.collection("tokens").doc("etsy").get();
  if (!doc.exists) return null;
  const { refresh_token } = doc.data()!;
  try {
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", requiredEnv("ETSY_CLIENT_ID"));
    params.append("refresh_token", refresh_token);
    const response = await axios.post("https://api.etsy.com/v3/public/oauth/token", params.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const { access_token, refresh_token: newRefreshToken } = response.data;
    await db.collection("tokens").doc("etsy").set({ access_token, refresh_token: newRefreshToken });
    return access_token;
  } catch (error) {
    console.error("Failed to refresh Etsy token:", error);
    return null;
  }
}

async function refreshSquareToken() {
  const doc = await db.collection("tokens").doc("square").get();
  if (!doc.exists) return null;
  const { refresh_token } = doc.data()!;
  try {
    const response = await axios.post("https://connect.squareup.com/oauth2/token", { grant_type: "refresh_token", client_id: process.env.SQUARE_CLIENT_ID, client_secret: process.env.SQUARE_CLIENT_SECRET, refresh_token });
    const { access_token, refresh_token: newRefreshToken } = response.data;
    await db.collection("tokens").doc("square").set({ access_token, refresh_token: newRefreshToken });
    return access_token;
  } catch (error) {
    console.error("Failed to refresh Square token:", error);
    return null;
  }
}

async function callEtsy(method: string, url: string, data: any = null, params: any = null) {
  const tokenDoc = await db.collection("tokens").doc("etsy").get();
  if (!tokenDoc.exists) throw new Error("Etsy not connected");
  const accessToken = tokenDoc.data()!.access_token;
  const makeRequest = async (token: string) => {
    const headers: any = { Authorization: `Bearer ${token}`, "x-api-key": requiredEnv("ETSY_CLIENT_ID") };
    let body = data;
    if (data && !(data instanceof URLSearchParams) && method !== "GET") {
      if (!url.endsWith("/inventory")) {
        const urlParams = new URLSearchParams();
        for (const key in data) urlParams.append(key, data[key]);
        body = urlParams.toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
      } else {
        headers["Content-Type"] = "application/json; charset=utf-8";
      }
    }
    return axios({ method, url, data: body, params, headers });
  };
  try {
    return await makeRequest(accessToken);
  } catch (err: any) {
    if (err.response?.status === 401) {
      const newToken = await refreshEtsyToken();
      if (newToken) return await makeRequest(newToken);
    }
    throw err;
  }
}

async function callSquare(method: string, url: string, data: any = null, params: any = null) {
  const tokenDoc = await db.collection("tokens").doc("square").get();
  if (!tokenDoc.exists) throw new Error("Square not connected");
  const accessToken = tokenDoc.data()!.access_token;
  const makeRequest = async (token: string) => axios({ method, url, data, params, headers: { Authorization: `Bearer ${token}`, "Square-Version": "2024-10-17", "Content-Type": "application/json" } });
  try {
    return await makeRequest(accessToken);
  } catch (err: any) {
    if (err.response?.status === 401) {
      const newToken = await refreshSquareToken();
      if (newToken) return await makeRequest(newToken);
    }
    throw err;
  }
}

async function startServer() {
  validateEnv();
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers["authorization"];
    const appSecret = process.env.APP_SECRET || "syncbridge-dev-secret";
    if (process.env.NODE_ENV === "production" && authHeader !== `Bearer ${appSecret}`) {
      return res.status(401).json({ error: "Unauthorized access" });
    }
    next();
  };

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/status", async (_req, res) => {
    try {
      const [etsyDoc, squareDoc] = await Promise.all([db.collection("tokens").doc("etsy").get(), db.collection("tokens").doc("square").get()]);
      res.json({ etsy: etsyDoc.exists, square: squareDoc.exists, canConnectEtsy: Boolean(process.env.ETSY_CLIENT_ID && process.env.ETSY_CLIENT_SECRET), canConnectSquare: Boolean(process.env.SQUARE_CLIENT_ID && process.env.SQUARE_CLIENT_SECRET) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error checking status" });
    }
  });

  app.get("/api/auth/etsy/url", async (_req, res) => {
    const state = await createOAuthState("etsy");
    const redirectUri = `${requiredEnv("APP_URL")}/api/auth/etsy/callback`;
    const params = new URLSearchParams({ client_id: requiredEnv("ETSY_CLIENT_ID"), redirect_uri: redirectUri, response_type: "code", scope: "listings_r listings_w", state });
    res.json({ url: `https://www.etsy.com/oauth/connect?${params}` });
  });

  app.get("/api/auth/etsy/callback", async (req, res) => {
    const { code, state } = req.query;
    if (typeof state !== "string" || !(await verifyOAuthState("etsy", state))) return res.status(400).send("Invalid OAuth state");
    try {
      const response = await axios.post("https://api.etsy.com/v3/public/oauth/token", { grant_type: "authorization_code", client_id: process.env.ETSY_CLIENT_ID, client_secret: process.env.ETSY_CLIENT_SECRET, code, redirect_uri: `${process.env.APP_URL}/api/auth/etsy/callback` });
      const { access_token, refresh_token } = response.data;
      await db.collection("tokens").doc("etsy").set({ access_token, refresh_token });
      res.send("Etsy successfully connected!");
    } catch (error) {
      console.error(error);
      res.status(500).send("Error connecting to Etsy");
    }
  });

  app.get("/api/auth/square/url", async (_req, res) => {
    const state = await createOAuthState("square");
    const redirectUri = `${requiredEnv("APP_URL")}/api/auth/square/callback`;
    const params = new URLSearchParams({ client_id: requiredEnv("SQUARE_CLIENT_ID"), redirect_uri: redirectUri, response_type: "code", scope: "ITEMS_READ ITEMS_WRITE ORDERS_READ MERCHANT_PROFILE_READ", state });
    res.json({ url: `https://connect.squareup.com/oauth2/authorize?${params}` });
  });

  app.get("/api/auth/square/callback", async (req, res) => {
    const { code, state } = req.query;
    if (typeof state !== "string" || !(await verifyOAuthState("square", state))) return res.status(400).send("Invalid OAuth state");
    try {
      const response = await axios.post("https://connect.squareup.com/oauth2/token", { grant_type: "authorization_code", client_id: process.env.SQUARE_CLIENT_ID, client_secret: process.env.SQUARE_CLIENT_SECRET, code, redirect_uri: `${process.env.APP_URL}/api/auth/square/callback` });
      const { access_token, refresh_token } = response.data;
      await db.collection("tokens").doc("square").set({ access_token, refresh_token });
      res.send("Square successfully connected!");
    } catch (error) {
      console.error(error);
      res.status(500).send("Error connecting to Square");
    }
  });

  app.get("/api/etsy/listings", async (_req, res) => {
    try {
      const shopResponse = await callEtsy("GET", "https://openapi.etsy.com/v3/application/users/me/shops");
      const shopId = shopResponse.data.results[0].shop_id;
      let allListings: any[] = [];
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      while (hasMore) {
        const listingsResponse = await callEtsy("GET", `https://openapi.etsy.com/v3/application/shops/${shopId}/listings`, null, { limit, offset, state: "active" });
        const results = listingsResponse.data.results || [];
        allListings = allListings.concat(results);
        if (results.length < limit) hasMore = false; else offset += limit;
      }
      res.json(allListings);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error fetching Etsy listings" });
    }
  });

  app.patch("/api/etsy/listings/:listing_id", async (req, res) => {
    try {
      const { listing_id } = req.params;
      const { title, description, price, quantity } = req.body;
      const basicData: any = {};
      if (title) basicData.title = title;
      if (description) basicData.description = description;
      if (Object.keys(basicData).length > 0) await callEtsy("PATCH", `https://openapi.etsy.com/v3/application/listings/${listing_id}`, basicData);

      if (price !== undefined || quantity !== undefined) {
        const currentInventory = await callEtsy("GET", `https://openapi.etsy.com/v3/application/listings/${listing_id}/inventory`);
        const products = currentInventory.data.products || [];
        if (products.length <= 1) {
          const inventoryPayload = { products: [{ sku: products[0]?.sku || undefined, property_values: [], offerings: [{ price: price ? parseFloat(price) : (products[0]?.offerings?.[0]?.price?.amount / products[0]?.offerings?.[0]?.price?.divisor), quantity: quantity !== undefined ? parseInt(quantity.toString()) : products[0]?.offerings?.[0]?.quantity, is_enabled: true }] }] };
          await callEtsy("PUT", `https://openapi.etsy.com/v3/application/listings/${listing_id}/inventory`, inventoryPayload);
        }
      }
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error updating Etsy listing" });
    }
  });

  app.delete("/api/etsy/listings/:listing_id", async (req, res) => {
    try {
      await callEtsy("DELETE", `https://openapi.etsy.com/v3/application/listings/${req.params.listing_id}`);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error deleting Etsy listing" });
    }
  });

  app.get("/api/square/inventory", async (_req, res) => {
    try {
      let allItems: any[] = [];
      let cursor = "";
      let hasMore = true;
      while (hasMore) {
        const response = await callSquare("GET", "https://connect.squareup.com/v2/catalog/list", null, { types: "ITEM", cursor: cursor || undefined });
        const objects = response.data.objects || [];
        allItems = allItems.concat(objects);
        cursor = response.data.cursor;
        if (!cursor) hasMore = false;
      }
      res.json(allItems);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error fetching Square inventory" });
    }
  });

  app.post("/api/etsy/sync-inventory", async (_req, res) => {
    try {
      let sqItems: any[] = [];
      let sqCursor = "";
      let hasMoreSq = true;
      while (hasMoreSq) {
        const sqCatalogResponse = await callSquare("GET", "https://connect.squareup.com/v2/catalog/list", null, { types: "ITEM", cursor: sqCursor || undefined });
        sqItems = sqItems.concat(sqCatalogResponse.data.objects || []);
        sqCursor = sqCatalogResponse.data.cursor;
        if (!sqCursor) hasMoreSq = false;
      }

      const variationIds = sqItems.flatMap((item: any) => (item.item_data.variations || []).map((v: any) => v.id)).filter(Boolean);
      let inventoryCounts: any[] = [];
      for (let i = 0; i < variationIds.length; i += 1000) {
        const batch = variationIds.slice(i, i + 1000);
        const sqInventoryResponse = await callSquare("POST", "https://connect.squareup.com/v2/inventory/counts/batch-retrieve", { catalog_object_ids: batch });
        inventoryCounts = inventoryCounts.concat(sqInventoryResponse.data.counts || []);
      }

      const shopResponse = await callEtsy("GET", "https://openapi.etsy.com/v3/application/users/me/shops");
      if (!shopResponse.data.results?.length) return res.status(404).json({ error: "No Etsy shop found" });
      const shopId = shopResponse.data.results[0].shop_id;
      let etsyListings: any[] = [];
      let etsyOffset = 0;
      const etsyLimit = 100;
      let hasMoreEtsy = true;
      while (hasMoreEtsy) {
        const etsyResponse = await callEtsy("GET", `https://openapi.etsy.com/v3/application/shops/${shopId}/listings`, null, { limit: etsyLimit, offset: etsyOffset, state: "active" });
        const results = etsyResponse.data.results || [];
        etsyListings = etsyListings.concat(results);
        if (results.length < etsyLimit) hasMoreEtsy = false; else etsyOffset += etsyLimit;
      }

      let syncedCount = 0;
      for (let i = 0; i < etsyListings.length; i += 5) {
        const batchListings = etsyListings.slice(i, i + 5);
        await Promise.all(batchListings.map(async (listing) => {
          const match = sqItems.find((item: any) => item.item_data.name.trim().toLowerCase() === listing.title.trim().toLowerCase());
          if (match && match.item_data.variations?.length === 1) {
            const firstVar = match.item_data.variations[0];
            const invMatch = inventoryCounts.find((c: any) => c.catalog_object_id === firstVar.id);
            if (invMatch) {
              const variationData = firstVar.item_variation_data;
              const priceMoney = variationData?.price_money;
              const syncPrice = priceMoney ? priceMoney.amount / 100 : null;
              const inventoryPayload = { products: [{ sku: listing.skus?.[0] || `SQ-${firstVar.id}`, property_values: [], offerings: [{ price: syncPrice || parseFloat(listing.price.amount) / listing.price.divisor, quantity: parseInt(invMatch.quantity), is_enabled: true }] }] };
              await callEtsy("PUT", `https://openapi.etsy.com/v3/application/listings/${listing.listing_id}/inventory`, inventoryPayload);
              syncedCount++;
            }
          }
        }));
        await new Promise((r) => setTimeout(r, 1000));
      }

      res.json({ success: true, message: `Successfully synchronized ${syncedCount} matching listings.` });
    } catch (err) {
      console.error("Sync error:", err);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  app.post("/api/listings/import", async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "No rows provided." });
    const accepted: any[] = [];
    const rejected: any[] = [];
    rows.forEach((row: any, idx: number) => {
      const title = String(row.title ?? "").trim();
      const quantity = Number(row.quantity);
      const price = Number(row.price);
      if (!title || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0) rejected.push({ row: idx + 1, reason: "Invalid schema" });
      else accepted.push({ ...row, title, quantity, price, importedAt: Date.now() });
    });
    const batch = db.batch();
    accepted.forEach((row) => {
      const id = String(row.listing_id || crypto.randomUUID());
      batch.set(db.collection("imported_listings").doc(id), row);
    });
    await batch.commit();
    res.json({ message: `Imported ${accepted.length} rows.`, accepted: accepted.length, rejected });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
