#!/usr/bin/env node

/**
 * Google OAuth2 Refresh Token Generator
 *
 * Modern OAuth2 Loopback Flow
 *
 * Usage:
 *   node scripts/get-refresh-token.js
 */

const { google } = require("googleapis");
const http = require("http");
const path = require("path");

try {
  require("dotenv").config({
    path: path.join(__dirname, "..", ".env"),
  });
} catch {}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing.");
  process.exit(1);
}

const PORT = 3001;
const REDIRECT_URI = `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get("code");

    if (!code) {
      res.end("Authorization failed.");
      return;
    }

    res.end(`
      <h2>✅ Authorization Successful</h2>
      <p>You can close this window and return to the terminal.</p>
    `);

    server.close();

    const { tokens } = await oauth2Client.getToken(code);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ GOOGLE_REFRESH_TOKEN");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log(tokens.refresh_token);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (!tokens.refresh_token) {
      console.log("⚠️ No refresh token received.");
      console.log("Remove previous permission and try again:");
      console.log("https://myaccount.google.com/permissions");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
});

server.listen(PORT, async () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Google OAuth Refresh Token Generator");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("Opening browser...\n");

  try {
    const { default: openBrowser } = await import("open");
    await openBrowser(authUrl);
  } catch (err) {
    console.log("Could not open browser automatically.");
  }

  console.log(
    `If your browser didn't open, visit:\n\n${authUrl}\n`
  );
});