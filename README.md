# SyncBridge Listing Dashboard

SyncBridge is a listing dashboard for Etsy + Square inventory sync and listing management.

## Deployment (required architecture)

This project is a **full-stack Node app**.

- Frontend is built by Vite.
- Backend API runs from `server.ts` / `dist/server.cjs` on Express.

If you deploy only static assets to Cloudflare Workers Pages, `GET /api/*` will fail. Use one of these models:

1. **Same-origin deployment (recommended):** deploy frontend and Node backend together.
2. **Split deployment:** host frontend separately and set `VITE_API_BASE_URL` to your backend URL.

## Required Environment Variables

- `APP_URL`
- `ETSY_CLIENT_ID`
- `ETSY_CLIENT_SECRET`
- `SQUARE_CLIENT_ID`
- `SQUARE_CLIENT_SECRET`
- `APP_SECRET` (optional)

## API behavior summary

- Public: `/api/health`, `/api/status`, OAuth URL/callback endpoints, listings read.
- Mutating: listing patch/delete, sync, import.
- OAuth state is persisted in Firestore (`oauth_states`) with TTL metadata and one-time consumption.

## Build and Run

```bash
npm install
npm run build
npm start
```

## Regression checks

```bash
npm run lint
npm run build
```
- **Frontend**: React 19, TypeScript, Tailwind CSS, Recharts for analytics.
- **Backend**: Express, Firebase Admin for data persistence.
- **Build**: Vite with TypeScript support.


## Deployment Notes (Cloudflare Workers vs Node)

This app requires a Node runtime for `server.ts` APIs. If you deploy frontend-only static assets to Workers, `/api/*` endpoints will fail. Deploy backend to a Node-compatible host (Cloud Run, Render, Fly, etc.) and serve frontend from same origin or configure reverse proxy/API base URL.
