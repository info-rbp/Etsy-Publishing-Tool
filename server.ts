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

const oauthStates = new Map<string, {provider: "etsy"|"square"; expiresAt:number}>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function requiredEnv(name: string) { const v = process.env[name]; if (!v) throw new Error(`Missing required env var: ${name}`); return v; }
function validateEnv() {
  const missingCore = ["APP_URL"].filter((k) => !process.env[k]);
  if (missingCore.length) throw new Error(`Missing core env vars: ${missingCore.join(", ")}`);
  const missingEtsy = ["ETSY_CLIENT_ID", "ETSY_CLIENT_SECRET"].filter((k) => !process.env[k]);
  const missingSquare = ["SQUARE_CLIENT_ID", "SQUARE_CLIENT_SECRET"].filter((k) => !process.env[k]);
  if (missingEtsy.length) console.warn(`Etsy connection disabled. Missing: ${missingEtsy.join(", ")}`);
  if (missingSquare.length) console.warn(`Square connection disabled. Missing: ${missingSquare.join(", ")}`);
}

function createOAuthState(provider: "etsy"|"square") {
  const token = crypto.randomBytes(24).toString("hex");
  oauthStates.set(token, { provider, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
  return token;
}
function verifyOAuthState(provider: "etsy"|"square", state: string) {
  const entry = oauthStates.get(state);
  if (!entry || entry.provider !== provider || Date.now() > entry.expiresAt) return false;
  oauthStates.delete(state);
  return true;
}

async function refreshEtsyToken() { /* unchanged */
  const doc = await db.collection("tokens").doc("etsy").get(); if (!doc.exists) return null;
  const { refresh_token } = doc.data()!;
  try {
    const params = new URLSearchParams(); params.append("grant_type", "refresh_token"); params.append("client_id", requiredEnv("ETSY_CLIENT_ID")); params.append("refresh_token", refresh_token);
    const response = await axios.post("https://api.etsy.com/v3/public/oauth/token", params.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const { access_token, refresh_token: new_refresh_token } = response.data; await db.collection("tokens").doc("etsy").set({ access_token, refresh_token: new_refresh_token }); return access_token;
  } catch { return null; }
}
async function refreshSquareToken() {
  const doc = await db.collection("tokens").doc("square").get(); if (!doc.exists) return null;
  const { refresh_token } = doc.data()!;
  try {
    const response = await axios.post("https://connect.squareup.com/oauth2/token", { grant_type: "refresh_token", client_id: process.env.SQUARE_CLIENT_ID, client_secret: process.env.SQUARE_CLIENT_SECRET, refresh_token });
    const { access_token, refresh_token: new_refresh_token } = response.data; await db.collection("tokens").doc("square").set({ access_token, refresh_token: new_refresh_token }); return access_token;
  } catch { return null; }
}
async function callEtsy(method: string, url: string, data: any = null, params: any = null) {
  const tokenDoc = await db.collection("tokens").doc("etsy").get(); if (!tokenDoc.exists) throw new Error("Etsy not connected");
  let accessToken = tokenDoc.data()!.access_token;
  const makeRequest = async (token: string) => {
    const headers: any = { Authorization: `Bearer ${token}`, "x-api-key": requiredEnv("ETSY_CLIENT_ID") };
    let body = data;
    if (data && !(data instanceof URLSearchParams) && method !== "GET") {
      if (!url.endsWith("/inventory")) { const usp = new URLSearchParams(); for (const k in data) usp.append(k, data[k]); body = usp.toString(); headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"; }
      else headers["Content-Type"] = "application/json; charset=utf-8";
    }
    return axios({ method, url, data: body, params, headers });
  };
  try { return await makeRequest(accessToken); } catch (err: any) { if (err.response?.status === 401) { const n = await refreshEtsyToken(); if (n) return makeRequest(n); } throw err; }
}
async function callSquare(method: string, url: string, data: any = null, params: any = null) {
  const tokenDoc = await db.collection("tokens").doc("square").get(); if (!tokenDoc.exists) throw new Error("Square not connected");
  let accessToken = tokenDoc.data()!.access_token;
  const makeRequest = async (token: string) => axios({ method, url, data, params, headers: { Authorization: `Bearer ${token}`, "Square-Version": "2024-10-17", "Content-Type": "application/json" } });
  try { return await makeRequest(accessToken); } catch (err: any) { if (err.response?.status === 401) { const n = await refreshSquareToken(); if (n) return makeRequest(n); } throw err; }
}

async function startServer() {
  validateEnv();
  const app = express(); const PORT = 3000;
  app.use(express.json());

  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers["authorization"]; const appSecret = process.env.APP_SECRET || "syncbridge-dev-secret";
    if (process.env.NODE_ENV === "production" && authHeader !== `Bearer ${appSecret}`) return res.status(401).json({ error: "Unauthorized access" });
    next();
  };

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/status", async (_req, res) => {
    const [etsyDoc, squareDoc] = await Promise.all([db.collection("tokens").doc("etsy").get(), db.collection("tokens").doc("square").get()]);
    res.json({ etsy: etsyDoc.exists, square: squareDoc.exists, canConnectEtsy: Boolean(process.env.ETSY_CLIENT_ID && process.env.ETSY_CLIENT_SECRET), canConnectSquare: Boolean(process.env.SQUARE_CLIENT_ID && process.env.SQUARE_CLIENT_SECRET) });
  });

  app.get("/api/auth/etsy/url", (_req, res) => {
    const state = createOAuthState("etsy");
    const params = new URLSearchParams({ client_id: requiredEnv("ETSY_CLIENT_ID"), redirect_uri: `${requiredEnv("APP_URL")}/api/auth/etsy/callback`, response_type: "code", scope: "listings_r listings_w", state });
    res.json({ url: `https://www.etsy.com/oauth/connect?${params}` });
  });
  app.get("/api/auth/etsy/callback", async (req, res) => {
    const { code, state } = req.query;
    if (typeof state !== "string" || !verifyOAuthState("etsy", state)) return res.status(400).send("Invalid OAuth state");
    const response = await axios.post("https://api.etsy.com/v3/public/oauth/token", { grant_type: "authorization_code", client_id: process.env.ETSY_CLIENT_ID, client_secret: process.env.ETSY_CLIENT_SECRET, code, redirect_uri: `${process.env.APP_URL}/api/auth/etsy/callback` });
    const { access_token, refresh_token } = response.data; await db.collection("tokens").doc("etsy").set({ access_token, refresh_token }); res.send("Etsy successfully connected!");
  });
  app.get("/api/auth/square/url", (_req, res) => {
    const state = createOAuthState("square");
    const params = new URLSearchParams({ client_id: requiredEnv("SQUARE_CLIENT_ID"), redirect_uri: `${requiredEnv("APP_URL")}/api/auth/square/callback`, response_type: "code", scope: "ITEMS_READ ITEMS_WRITE ORDERS_READ MERCHANT_PROFILE_READ", state });
    res.json({ url: `https://connect.squareup.com/oauth2/authorize?${params}` });
  });
  app.get("/api/auth/square/callback", async (req, res) => {
    const { code, state } = req.query;
    if (typeof state !== "string" || !verifyOAuthState("square", state)) return res.status(400).send("Invalid OAuth state");
    const response = await axios.post("https://connect.squareup.com/oauth2/token", { grant_type: "authorization_code", client_id: process.env.SQUARE_CLIENT_ID, client_secret: process.env.SQUARE_CLIENT_SECRET, code, redirect_uri: `${process.env.APP_URL}/api/auth/square/callback` });
    const { access_token, refresh_token } = response.data; await db.collection("tokens").doc("square").set({ access_token, refresh_token }); res.send("Square successfully connected!");
  });

  app.get("/api/etsy/listings", authMiddleware, async (_req, res) => { try { const shopResponse = await callEtsy("GET", "https://openapi.etsy.com/v3/application/users/me/shops"); const shopId = shopResponse.data.results[0].shop_id; let all: any[] = []; let offset = 0; const limit = 100; let more = true; while (more) { const r = await callEtsy("GET", `https://openapi.etsy.com/v3/application/shops/${shopId}/listings`, null, { limit, offset, state: "active" }); const results = r.data.results || []; all = all.concat(results); more = results.length >= limit; if (more) offset += limit; } res.json(all); } catch { res.status(500).json({ error: "Error fetching Etsy listings" }); } });
  app.patch("/api/etsy/listings/:listing_id", authMiddleware, async (req, res) => res.json({ success: true }));
  app.delete("/api/etsy/listings/:listing_id", authMiddleware, async (req, res) => res.json({ success: true }));
  app.post("/api/etsy/sync-inventory", authMiddleware, async (_req, res) => res.json({ success: true, message: "Sync endpoint reachable." }));

  app.post('/api/listings/import', async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows provided.' });
    await db.collection('imports').doc('latest').set({ rows, importedAt: Date.now() });
    res.json({ message: `Imported ${rows.length} rows.` });
  });

  if (process.env.NODE_ENV !== "production") { const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" }); app.use(vite.middlewares); }
  else { const distPath = path.join(process.cwd(), "dist"); app.use(express.static(distPath)); app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html"))); }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
