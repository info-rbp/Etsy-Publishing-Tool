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
  app.put("/api/etsy/listings/:listing_id", express.json(), async (req, res) => {
      try {
        const { listing_id } = req.params;
        const { title, description, price, quantity } = req.body;
        
        const tokenDoc = await db.collection("tokens").doc("etsy").get();
        if (!tokenDoc.exists) {
          return res.status(401).json({ error: "Not connected to Etsy" });
        }
        const { access_token } = tokenDoc.data()!;
        
        const params = new URLSearchParams();
        if (title) params.append("title", title);
        if (description) params.append("description", description);
        if (price) params.append("price", price);
        if (quantity) params.append("quantity", quantity.toString());

        await axios.put(`https://openapi.etsy.com/v3/application/listings/${listing_id}`, 
          params.toString(),
          {
            headers: { 
              "Authorization": `Bearer ${access_token}`, 
              "x-api-key": process.env.ETSY_CLIENT_ID,
              "Content-Type": "application/x-www-form-urlencoded"
            }
          }
        );
        
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
        headers: { "Authorization": `Bearer ${access_token}`, "Square-Version": "2025-05-25" }
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
        if (!etsyTokenDoc.exists || !sqTokenDoc.exists) return res.status(401).json({ error: "Not connected to both" });
        
        // Placeholder sync logic: 
        // 1. Fetch Sq inventory
        // 2. Fetch Etsy listings
        // 3. Match by name
        // 4. Update Etsy quantity
        res.json({ success: true, message: "Sync functionality needs matching implementation" });
    } catch (err) {
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
