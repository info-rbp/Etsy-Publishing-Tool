# SyncBridge Listing Dashboard

SyncBridge is a robust listing dashboard application designed to manage and synchronize Etsy and Square product listings seamlessly.

## Key Features

- **Multi-Platform Management**: Connect, view, and update listings from Etsy and Square.
- **Inventory Analytics**: Visualize your stock distribution with interactive inventory charts.
- **Efficient Search**: Real-time filtering to quickly locate listings in your catalog.
- **Data Import/Export**: Seamlessly import/export listing data via CSV.
- **Direct Management**: Inline editing, updates, and deletion of Etsy listings.

## Deployment Guide

To deploy this application, follow these steps:

### Prerequisites

1. **GCP Project**: Ensure you have a Google Cloud Platform project with Firestore enabled.
2. **Etsy API Credentials**: Obtain your API Key and Secret from the Etsy Developer Portal.
3. **Square API Credentials**: Obtain your API Key and Secret from the Square Developer Dashboard.
4. **Environment Variables**: Set the following environment variables in your deployment environment:
   - `ETSY_CLIENT_ID`
   - `ETSY_CLIENT_SECRET`
   - `SQUARE_CLIENT_ID`
   - `SQUARE_CLIENT_SECRET`
   - `APP_URL` (the URL where your app is hosted)
   - `GEMINI_API_KEY` (if used for AI features)

### Build and Deployment

1. **Build**: Run `npm run build`. This generates the optimized production build in the `dist` folder.
2. **Start**: The application uses `dist/server.cjs` for production. Ensure you follow the requirements for full-stack apps outlined in the framework documentation.
3. **Environment**: Ensure the application is bound to port `3000` and host `0.0.0.0`.

## Technical Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Recharts for analytics.
- **Backend**: Express, Firebase Admin for data persistence.
- **Build**: Vite with TypeScript support.
