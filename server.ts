import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import axios from "axios";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
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
      const tokenDoc = await db.collection("tokens").doc("etsy").get();
      if (!tokenDoc.exists) {
        return res.status(401).json({ error: "Not connected to Etsy" });
      }
      const { access_token } = tokenDoc.data()!;
      
      // First get shop id
      const shopResponse = await axios.get("https://openapi.etsy.com/v3/application/users/me/shops", {
        headers: { "Authorization": `Bearer ${access_token}`, "x-api-key": process.env.ETSY_CLIENT_ID }
      });
      const shopId = shopResponse.data.results[0].shop_id;

      // Then get listings
      const listingsResponse = await axios.get(`https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active`, {
        headers: { "Authorization": `Bearer ${access_token}`, "x-api-key": process.env.ETSY_CLIENT_ID }
      });
      
      res.json(listingsResponse.data.results);
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

      const tokenDoc = await db.collection("tokens").doc("etsy").get();
      if (!tokenDoc.exists) {
        return res.status(401).json({ error: "Not connected to Etsy" });
      }
      const { access_token } = tokenDoc.data()!;

      // Update basic fields
      const basicData: any = {};
      if (title) basicData.title = title;
      if (description) basicData.description = description;

      if (Object.keys(basicData).length > 0) {
        await axios.patch(`https://openapi.etsy.com/v3/application/listings/${listing_id}`,
          basicData,
          {
            headers: { 
              "Authorization": `Bearer ${access_token}`, 
              "x-api-key": process.env.ETSY_CLIENT_ID,
              "Content-Type": "application/json"
            }
          }
        );
      }

      // Update price/quantity via inventory endpoint if provided
      if (price !== undefined || quantity !== undefined) {
        // We need the current inventory to avoid overwriting other fields if we don't have them
        // For simplicity in this dashboard, we'll construct a simple payload
        const inventoryPayload = {
          products: [
            {
              property_values: [],
              offerings: [
                {
                  price: price ? parseFloat(price) : undefined,
                  quantity: quantity !== undefined ? parseInt(quantity.toString()) : undefined,
                  is_enabled: true
                }
              ]
            }
          ]
        };
        
        await axios.put(`https://openapi.etsy.com/v3/application/listings/${listing_id}/inventory`,
          inventoryPayload,
          {
            headers: {
              "Authorization": `Bearer ${access_token}`,
              "x-api-key": process.env.ETSY_CLIENT_ID,
              "Content-Type": "application/json"
            }
          }
        );
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
      
      const tokenDoc = await db.collection("tokens").doc("etsy").get();
      if (!tokenDoc.exists) {
        return res.status(401).json({ error: "Not connected to Etsy" });
      }
      const { access_token } = tokenDoc.data()!;
      
      await axios.delete(`https://openapi.etsy.com/v3/application/listings/${listing_id}`, 
        {
          headers: { 
            "Authorization": `Bearer ${access_token}`, 
            "x-api-key": process.env.ETSY_CLIENT_ID
          }
        }
      );
      
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
      const tokenDoc = await db.collection("tokens").doc("square").get();
      if (!tokenDoc.exists) return res.status(401).json({ error: "Not connected to Square" });
      const { access_token } = tokenDoc.data()!;
      
      const response = await axios.get("https://connect.squareup.com/v2/catalog/list?types=ITEM", {
        headers: { "Authorization": `Bearer ${access_token}`, "Square-Version": "2024-10-17" }
      });
      res.json(response.data.objects);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error fetching Square inventory" });
    }
  });

  // Sync Etsy
  app.post("/api/etsy/sync-inventory", async (req, res) => {
    try {
      const etsyTokenDoc = await db.collection("tokens").doc("etsy").get();
      const sqTokenDoc = await db.collection("tokens").doc("square").get();

      if (!etsyTokenDoc.exists || !sqTokenDoc.exists) {
        return res.status(401).json({ error: "Not connected to both Etsy and Square" });
      }

      const etsyToken = etsyTokenDoc.data()!.access_token;
      const squareToken = sqTokenDoc.data()!.access_token;

      // 1. Fetch Square catalog items to get names and variation IDs
      const sqCatalogResponse = await axios.get("https://connect.squareup.com/v2/catalog/list?types=ITEM", {
        headers: {
          "Authorization": `Bearer ${squareToken}`,
          "Square-Version": "2024-10-17"
        }
      });
      const sqItems = sqCatalogResponse.data.objects || [];

      // 2. Fetch Square inventory counts in batch
      const variationIds = sqItems.flatMap((item: any) =>
        (item.item_data.variations || []).map((v: any) => v.id)
      ).filter(Boolean);

      let inventoryCounts: any[] = [];
      if (variationIds.length > 0) {
        // Square batch retrieve has a limit, but for this app we'll assume it's within limits or handled by basic batch
        const sqInventoryResponse = await axios.post("https://connect.squareup.com/v2/inventory/counts/batch-retrieve",
          { catalog_object_ids: variationIds.slice(0, 1000) }, // Limit to 1000 as per Square API
          {
            headers: {
              "Authorization": `Bearer ${squareToken}`,
              "Square-Version": "2024-10-17",
              "Content-Type": "application/json"
            }
          }
        );
        inventoryCounts = sqInventoryResponse.data.counts || [];
      }

      // 3. Fetch Etsy listings
      const shopResponse = await axios.get("https://openapi.etsy.com/v3/application/users/me/shops", {
        headers: {
          "Authorization": `Bearer ${etsyToken}`,
          "x-api-key": process.env.ETSY_CLIENT_ID
        }
      });

      if (!shopResponse.data.results || shopResponse.data.results.length === 0) {
        return res.status(404).json({ error: "No Etsy shop found" });
      }

      const shopId = shopResponse.data.results[0].shop_id;
      const etsyResponse = await axios.get(`https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active`, {
        headers: {
          "Authorization": `Bearer ${etsyToken}`,
          "x-api-key": process.env.ETSY_CLIENT_ID
        }
      });
      const etsyListings = etsyResponse.data.results || [];

      // 4. Match by name and update Etsy quantity
      let syncedCount = 0;
      for (const listing of etsyListings) {
        const match = sqItems.find((item: any) =>
          item.item_data.name.toLowerCase() === listing.title.toLowerCase()
        );
        
        if (match && match.item_data.variations && match.item_data.variations.length > 0) {
          // Find inventory count for the first variation
          const firstVar = match.item_data.variations[0];
          const firstVarId = firstVar.id;
          const invMatch = inventoryCounts.find((c: any) => c.catalog_object_id === firstVarId);

          if (invMatch) {
            const syncQuantity = parseInt(invMatch.quantity);
            const priceMoney = firstVar.item_data?.price_money || firstVar.variation_data?.price_money;
            const syncPrice = priceMoney ? priceMoney.amount / 100 : null; // Square amounts are in cents

            // Update Etsy inventory using the complex structure required by v3
            // This is a simplified version that assumes a single product per listing (common for simple shops)
            const inventoryPayload = {
              products: [
                {
                  sku: listing.skus?.[0] || `SQ-${firstVarId}`,
                  property_values: [], // Simple product, no variations
                  offerings: [
                    {
                      price: syncPrice || parseFloat(listing.price.amount) / listing.price.divisor,
                      quantity: syncQuantity,
                      is_enabled: true
                    }
                  ]
                }
              ]
            };

            await axios.put(`https://openapi.etsy.com/v3/application/listings/${listing.listing_id}/inventory`,
              inventoryPayload,
              {
                headers: {
                  "Authorization": `Bearer ${etsyToken}`,
                  "x-api-key": process.env.ETSY_CLIENT_ID,
                  "Content-Type": "application/json"
                }
              }
            );
            syncedCount++;
          }
        }
      }

      res.json({
        success: true,
        message: `Successfully synchronized ${syncedCount} matching listings.`
      });
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
