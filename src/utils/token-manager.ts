import { google, Auth } from 'googleapis';
import logger from './logger';

let oauth2Client: Auth.OAuth2Client | null = null;
let tokenExpiryTime: number | null = null;

/**
 * Creates and returns a configured OAuth2 client with auto-refresh capability.
 */
export function getOAuth2Client(): Auth.OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'urn:ietf:wg:oauth:2.0:oob',
    );

    oauth2Client!.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    // Listen for token refresh events
    oauth2Client!.on('tokens', (tokens: Auth.Credentials) => {
      if (tokens.expiry_date) {
        tokenExpiryTime = tokens.expiry_date;
        logger.info('Google OAuth token refreshed', {
          expiresAt: new Date(tokens.expiry_date).toISOString(),
        });
      }
    });
  }

  return oauth2Client!;
}

/**
 * Ensures the access token is valid, refreshing it if it's about to expire.
 * Tokens are refreshed when they have less than 5 minutes remaining.
 */
export async function ensureValidToken(): Promise<string> {
  const client = getOAuth2Client();
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer

  const isExpiringSoon = tokenExpiryTime !== null && Date.now() >= tokenExpiryTime - BUFFER_MS;

  if (!tokenExpiryTime || isExpiringSoon) {
    logger.info('Refreshing Google OAuth token...');
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);

    if (credentials.expiry_date) {
      tokenExpiryTime = credentials.expiry_date;
    }

    logger.info('Google OAuth token refreshed successfully');
  }

  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error('Failed to obtain Google access token');
  }

  return token.token;
}

/**
 * Resets the OAuth2 client instance (useful for testing or credential changes).
 */
export function resetOAuth2Client(): void {
  oauth2Client = null;
  tokenExpiryTime = null;
}
