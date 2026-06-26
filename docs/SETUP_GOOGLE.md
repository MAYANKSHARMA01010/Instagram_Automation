# Google API Setup Guide

This guide walks you through setting up Google Drive API access and obtaining an OAuth2 refresh token.

---

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"New Project"** at the top
3. Name it `Instagram Reels Uploader`
4. Click **"Create"**

---

## Step 2: Enable the Google Drive API

1. In your project, go to **APIs & Services → Library**
2. Search for **"Google Drive API"**
3. Click it → click **"Enable"**

---

## Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **"+ Create Credentials"** → **"OAuth client ID"**
3. If prompted, configure the OAuth consent screen first:
   - User Type: **External**
   - App name: `Instagram Reels Uploader`
   - Add your email as a test user
4. Application type: **Desktop app**
5. Name: `Reels Uploader`
6. Click **"Create"**

You'll get a **Client ID** and **Client Secret** — copy these.

---

## Step 4: Add to .env

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
```

---

## Step 5: Get the Refresh Token

Run the helper script:

```bash
node scripts/get-refresh-token.js
```

1. Open the URL shown in your browser
2. Sign in with your Google account
3. Grant access to Google Drive
4. Copy the authorization code
5. Paste it in the terminal

You'll receive your `GOOGLE_REFRESH_TOKEN`. Add it to `.env`:

```env
GOOGLE_REFRESH_TOKEN=1//04...
```

---

## Step 6: Get Google Drive Folder IDs

1. Open [Google Drive](https://drive.google.com)
2. Create two folders:
   - `Instagram/Videos` — where you'll drop videos
   - `Instagram/Uploaded` — where processed videos move to
3. Open each folder and copy the ID from the URL:

```
https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID
```

Add to `.env`:

```env
GOOGLE_DRIVE_FOLDER_ID=your_videos_folder_id
GOOGLE_DRIVE_UPLOADED_FOLDER_ID=your_uploaded_folder_id
```

---

## Troubleshooting

**"Access blocked: Instagram Reels Uploader has not completed the Google verification process"**
→ Add your Google account as a test user in the OAuth consent screen under "Test users"

**"invalid_grant" error**
→ Your refresh token is invalid. Run `node scripts/get-refresh-token.js` again.

**Token expired**
→ The app auto-refreshes tokens. If it fails, regenerate the refresh token.
