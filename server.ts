import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import axios from "axios";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

async function refreshEtsyToken() {
  const doc = await db.collection("tokens").doc("etsy").get();
  if (!doc.exists) return null;
  const { refresh_token } = doc.data()!;

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", process.env.ETSY_CLIENT_ID!);
    params.append("refresh_token", refresh_token);

    const response = await axios.post("https://api.etsy.com/v3/public/oauth/token",
      params.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );
    const { access_token, refresh_token: new_refresh_token } = response.data;
    await db.collection("tokens").doc("etsy").set({ access_token, refresh_token: new_refresh_token });
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
    const response = await axios.post("https://connect.squareup.com/oauth2/token", {
      grant_type: "refresh_token",
      client_id: process.env.SQUARE_CLIENT_ID,
      client_secret: process.env.SQUARE_CLIENT_SECRET,
      refresh_token: refresh_token
    });
    const { access_token, refresh_token: new_refresh_token } = response.data;
    await db.collection("tokens").doc("square").set({ access_token, refresh_token: new_refresh_token });
    return access_token;
  } catch (error) {
    console.error("Failed to refresh Square token:", error);
    return null;
  }
}

async function callEtsy(method: string, url: string, data: any = null, params: any = null) {
  const tokenDoc = await db.collection("tokens").doc("etsy").get();
  if (!tokenDoc.exists) throw new Error("Etsy not connected");
  let access_token = tokenDoc.data()!.access_token;

  const makeRequest = async (token: string) => {
    let headers: any = {
      "Authorization": `Bearer ${token}`,
      "x-api-key": `${process.env.ETSY_CLIENT_ID}:${process.env.ETSY_CLIENT_SECRET}`
    };

    let body = data;
    if (data && !(data instanceof URLSearchParams) && method !== 'GET') {
      if (!url.endsWith('/inventory')) {
        const urlParams = new URLSearchParams();
        for (const key in data) urlParams.append(key, data[key]);
        body = urlParams.toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
      } else {
        headers["Content-Type"] = "application/json; charset=utf-8";
      }
    }

    return await axios({ method, url, data: body, params, headers });
  };

  try {
    return await makeRequest(access_token);
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
  let access_token = tokenDoc.data()!.access_token;

  const makeRequest = async (token: string) => {
    return await axios({
      method,
      url,
      data,
      params,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Square-Version": "2024-10-17",
        "Content-Type": "application/json"
      }
    });
  };

  try {
    return await makeRequest(access_token);
  } catch (err: any) {
    if (err.response?.status === 401) {
      const newToken = await refreshSquareToken();
      if (newToken) return await makeRequest(newToken);
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Simple auth middleware
  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // For this dashboard applet, we'll check for a basic secret in the headers
    // in a real-world scenario, you'd use proper session/JWT auth.
    const authHeader = req.headers['authorization'];
    const appSecret = process.env.APP_SECRET || 'syncbridge-dev-secret';

    if (process.env.NODE_ENV === 'production' && (!authHeader || authHeader !== `Bearer ${appSecret}`)) {
      return res.status(401).json({ error: "Unauthorized access" });
    }
    next();
  };

  // API routes
  app.use("/api", authMiddleware);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Etsy OAuth URL
  app.get("/api/auth/etsy/url", (req, res) => {
    const redirectUri = `${process.env.APP_URL}/api/auth/etsy/callback`;
    const params = new URLSearchParams({
      client_id: process.env.ETSY_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "listings_r listings_w", // Example scopes
      state: "some_random_state_here"
    });
    res.json({ url: `https://www.etsy.com/oauth/connect?${params}` });
  });

  // Etsy OAuth Callback
  app.get("/api/auth/etsy/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const response = await axios.post("https://api.etsy.com/v3/public/oauth/token", {
        grant_type: "authorization_code",
        client_id: process.env.ETSY_CLIENT_ID,
        client_secret: process.env.ETSY_CLIENT_SECRET,
        code: code,
        redirect_uri: `${process.env.APP_URL}/api/auth/etsy/callback`
      });
      
      const { access_token, refresh_token } = response.data;
      await db.collection("tokens").doc("etsy").set({ access_token, refresh_token });
      res.send("Etsy successfully connected!");
    } catch (error) {
      console.error(error);
      res.status(500).send("Error connecting to Etsy");
    }
  });

  // Get Integration Status
  app.get("/api/status", async (req, res) => {
    try {
      const etsyDoc = await db.collection("tokens").doc("etsy").get();
      const squareDoc = await db.collection("tokens").doc("square").get();
      res.json({ etsy: etsyDoc.exists, square: squareDoc.exists });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error checking status" });
    }
  });

  // Get Etsy Listings
  app.get("/api/etsy/listings", async (req, res) => {
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
        if (results.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }
      res.json(allListings);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error fetching Etsy listings" });
    }
  });

  // Update Etsy Listing
  app.patch("/api/etsy/listings/:listing_id", express.json(), async (req, res) => {
    try {
      const { listing_id } = req.params;
      const { title, description, price, quantity } = req.body;

      // Update basic fields
      const basicData: any = {};
      if (title) basicData.title = title;
      if (description) basicData.description = description;

      if (Object.keys(basicData).length > 0) {
        await callEtsy("PATCH", `https://openapi.etsy.com/v3/application/listings/${listing_id}`, basicData);
      }

      // Update price/quantity via inventory endpoint if provided
      if (price !== undefined || quantity !== undefined) {
        // First, check if the listing has variations to avoid corrupting it
        const currentInventory = await callEtsy("GET", `https://openapi.etsy.com/v3/application/listings/${listing_id}/inventory`);
        const products = currentInventory.data.products || [];
        
        if (products.length > 1) {
          // If it's a complex listing, we skip updating price/qty for safety in this basic dashboard
          console.warn(`Listing ${listing_id} has variations. Skipping price/quantity update for safety.`);
        } else {
          // It's a simple listing or the first update
          const inventoryPayload = {
            products: [
              {
                sku: products[0]?.sku || undefined,
                property_values: [],
                offerings: [
                  {
                    price: price ? parseFloat(price) : (products[0]?.offerings?.[0]?.price?.amount / products[0]?.offerings?.[0]?.price?.divisor),
                    quantity: quantity !== undefined ? parseInt(quantity.toString()) : products[0]?.offerings?.[0]?.quantity,
                    is_enabled: true
                  }
                ]
              }
            ]
          };

          await callEtsy("PUT", `https://openapi.etsy.com/v3/application/listings/${listing_id}/inventory`, inventoryPayload);
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error updating Etsy listing" });
    }
  });

  // Delete Etsy Listing
  app.delete("/api/etsy/listings/:listing_id", async (req, res) => {
    try {
      const { listing_id } = req.params;
      await callEtsy("DELETE", `https://openapi.etsy.com/v3/application/listings/${listing_id}`);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error deleting Etsy listing" });
    }
  });

  // Square OAuth URL
  app.get("/api/auth/square/url", (req, res) => {
    const redirectUri = `${process.env.APP_URL}/api/auth/square/callback`;
    const params = new URLSearchParams({
      client_id: process.env.SQUARE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "ITEMS_READ ITEMS_WRITE ORDERS_READ MERCHANT_PROFILE_READ", // Example scopes
      state: "some_random_state_here"
    });
    res.json({ url: `https://connect.squareup.com/oauth2/authorize?${params}` });
  });

  // Square OAuth Callback
  app.get("/api/auth/square/callback", async (req, res) => {
    const { code } = req.query;
    try {
        const response = await axios.post("https://connect.squareup.com/oauth2/token", {
          grant_type: "authorization_code",
          client_id: process.env.SQUARE_CLIENT_ID,
          client_secret: process.env.SQUARE_CLIENT_SECRET,
          code: code,
          redirect_uri: `${process.env.APP_URL}/api/auth/square/callback`
        });
        
        const { access_token, refresh_token } = response.data;
        await db.collection("tokens").doc("square").set({ access_token, refresh_token });
        res.send("Square successfully connected!");
      } catch (error) {
        console.error(error);
        res.status(500).send("Error connecting to Square");
      }
  });

  // Square Inventory
  app.get("/api/square/inventory", async (req, res) => {
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

  // Sync Etsy
  app.post("/api/etsy/sync-inventory", async (req, res) => {
    try {
      // 1. Fetch Square catalog items to get names and variation IDs (handling pagination)
      let sqItems: any[] = [];
      let sqCursor = "";
      let hasMoreSq = true;
      while (hasMoreSq) {
        const sqCatalogResponse = await callSquare("GET", "https://connect.squareup.com/v2/catalog/list", null, { types: "ITEM", cursor: sqCursor || undefined });
        sqItems = sqItems.concat(sqCatalogResponse.data.objects || []);
        sqCursor = sqCatalogResponse.data.cursor;
        if (!sqCursor) hasMoreSq = false;
      }

      // 2. Fetch Square inventory counts in batch
      const variationIds = sqItems.flatMap((item: any) =>
        (item.item_data.variations || []).map((v: any) => v.id)
      ).filter(Boolean);

      let inventoryCounts: any[] = [];
      if (variationIds.length > 0) {
        // Square batch retrieve limit is 1000
        for (let i = 0; i < variationIds.length; i += 1000) {
          const batch = variationIds.slice(i, i + 1000);
          const sqInventoryResponse = await callSquare("POST", "https://connect.squareup.com/v2/inventory/counts/batch-retrieve", { catalog_object_ids: batch });
          inventoryCounts = inventoryCounts.concat(sqInventoryResponse.data.counts || []);
        }
      }

      // 3. Fetch Etsy listings (handling pagination)
      const shopResponse = await callEtsy("GET", "https://openapi.etsy.com/v3/application/users/me/shops");
      if (!shopResponse.data.results || shopResponse.data.results.length === 0) return res.status(404).json({ error: "No Etsy shop found" });
      const shopId = shopResponse.data.results[0].shop_id;

      let etsyListings: any[] = [];
      let etsyOffset = 0;
      const etsyLimit = 100;
      let hasMoreEtsy = true;

      while (hasMoreEtsy) {
        const etsyResponse = await callEtsy("GET", `https://openapi.etsy.com/v3/application/shops/${shopId}/listings`, null, { limit: etsyLimit, offset: etsyOffset, state: "active" });
        const results = etsyResponse.data.results || [];
        etsyListings = etsyListings.concat(results);
        if (results.length < etsyLimit) hasMoreEtsy = false;
        else etsyOffset += etsyLimit;
      }

      // 4. Match and update with concurrency control (basic throttling)
      let syncedCount = 0;
      const BATCH_SIZE = 5; // Low concurrency to avoid rate limits
      for (let i = 0; i < etsyListings.length; i += BATCH_SIZE) {
        const batchListings = etsyListings.slice(i, i + BATCH_SIZE);
        await Promise.all(batchListings.map(async (listing) => {
          const match = sqItems.find((item: any) => item.item_data.name.trim().toLowerCase() === listing.title.trim().toLowerCase());

          if (match && match.item_data.variations?.length === 1) { // Only sync simple products for now to avoid corruption
            const firstVar = match.item_data.variations[0];
            const invMatch = inventoryCounts.find((c: any) => c.catalog_object_id === firstVar.id);

            if (invMatch) {
              const syncQuantity = parseInt(invMatch.quantity);
              const variationData = firstVar.item_variation_data;
              const priceMoney = variationData?.price_money;
              const syncPrice = priceMoney ? priceMoney.amount / 100 : null;

              const inventoryPayload = {
                products: [{
                  sku: listing.skus?.[0] || `SQ-${firstVar.id}`,
                  property_values: [],
                  offerings: [{
                    price: syncPrice || parseFloat(listing.price.amount) / listing.price.divisor,
                    quantity: syncQuantity,
                    is_enabled: true
                  }]
                }]
              };

              try {
                await callEtsy("PUT", `https://openapi.etsy.com/v3/application/listings/${listing.listing_id}/inventory`, inventoryPayload);
                syncedCount++;
              } catch (err) {
                console.error(`Failed to sync listing ${listing.listing_id}:`, err);
              }
            }
          }
        }));
        // Small delay between batches
        await new Promise(r => setTimeout(r, 1000));
      }

      res.json({ success: true, message: `Successfully synchronized ${syncedCount} matching listings.` });
    } catch (err) {
      console.error("Sync error:", err);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
