# Instagram Graph API Setup Guide

This guide walks you through setting up a Meta App and obtaining an Instagram Graph API access token for uploading Reels.

---

## Prerequisites

- An **Instagram Business** or **Creator** account
- A **Facebook Page** connected to your Instagram account
- A **Meta Developer** account at [developers.facebook.com](https://developers.facebook.com)

---

## Step 1: Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **"My Apps"** → **"Create App"**
3. Choose **"Business"** as the app type
4. Fill in:
   - **Display name**: `Reels Uploader`
   - **Contact email**: your email
5. Click **"Create App"**

---

## Step 2: Add Instagram Graph API Product

1. In your app dashboard, click **"Add Products"**
2. Find **"Instagram Graph API"** and click **"Set Up"**

---

## Step 3: Configure Instagram Basic Display

1. Under **"Instagram"** in the left sidebar, click **"API setup with Instagram login"**
2. Under **Instagram Testers**, add your Instagram account
3. Accept the tester invitation in your Instagram app:
   - Settings → Apps and Websites → Tester Invites

---

## Step 4: Get Your Instagram Account ID

1. In the Meta App dashboard, go to **Graph API Explorer**
2. Select your App from the dropdown
3. In the API version, select `v19.0` (or latest)
4. Run: `GET /me/accounts`
5. Find your Facebook Page in the response and note the `id`
6. Then run: `GET /{page-id}?fields=instagram_business_account`
7. Note the `instagram_business_account.id` — this is your `INSTAGRAM_ACCOUNT_ID`

---

## Step 5: Get Your Facebook Page ID

From the `/me/accounts` response in Step 4, copy the `id` of your Facebook Page.

---

## Step 6: Generate a Long-Lived Access Token

### 6a. Get a Short-Lived Token

1. Go to **Graph API Explorer**
2. Click **"Generate Access Token"**
3. Select these permissions:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
   - `business_management`
4. Click **"Generate"** and copy the token

### 6b. Convert to Long-Lived Token

Long-lived tokens last 60 days. Run this in your terminal:

```bash
curl -i -X GET "https://graph.facebook.com/v19.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=YOUR_APP_ID
  &client_secret=YOUR_APP_SECRET
  &fb_exchange_token=YOUR_SHORT_LIVED_TOKEN"
```

Copy the returned `access_token`.

### 6c. (Optional) Get a Never-Expiring Page Token

For production, use a never-expiring page access token:

```bash
# 1. Get your page access token using the long-lived user token
curl "https://graph.facebook.com/v19.0/{PAGE_ID}?fields=access_token&access_token={LONG_LIVED_USER_TOKEN}"

# The returned access_token is your never-expiring page token
```

---

## Step 7: Add to .env

```env
INSTAGRAM_ACCOUNT_ID=your_instagram_business_account_id
FACEBOOK_PAGE_ID=your_facebook_page_id
GRAPH_API_TOKEN=your_long_lived_access_token
```

---

## Step 8: Verify Setup

Test that your token works:

```bash
curl "https://graph.facebook.com/v19.0/{INSTAGRAM_ACCOUNT_ID}?fields=id,username&access_token={TOKEN}"
```

You should see your Instagram account details.

---

## Permissions Required

| Permission | Purpose |
|---|---|
| `instagram_basic` | Read basic profile |
| `instagram_content_publish` | Upload and publish content |
| `pages_show_list` | Access Facebook Pages |
| `pages_read_engagement` | Read page metrics |

---

## Rate Limits

- **Content Publishing Limit**: 50 API calls per 24 hours per Instagram account
- **Publishing Limit**: Up to 25 Reels per 24 hours
- If you hit limits, the app will retry automatically

---

## Troubleshooting

**"Invalid OAuth access token"**
→ Token has expired. Generate a new long-lived token.

**"User does not have sufficient administrative permission"**
→ Your Facebook Page must be connected to the Instagram Business account.

**"(#200) The user hasn't authorized the application"**
→ Re-generate the access token with all required permissions.

**Container status = ERROR**
→ Check the `errorCode` in the API response. Common codes:
- `2207026` — Video format unsupported
- `2207001` — Video duration too short (must be 3-90 seconds for Reels)
- `2207050` — Video file corrupted
