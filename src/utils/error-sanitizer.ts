import axios, { AxiosError } from 'axios';

/**
 * Replaces credentials in URLs or obvious token strings.
 */
export function maskSensitiveStrings(text: string): string {
  if (!text) return text;
  
  // Mask URL credentials (e.g. http://user:pass@proxy.com)
  let masked = text.replace(/(https?|socks5):\/\/([^:@"\s]+):([^:@"\s]+)@/gi, '$1://[REDACTED]:[REDACTED]@');
  
  // Mask access_token=...
  masked = masked.replace(/access_token=([^&\s]+)/gi, 'access_token=[REDACTED]');
  
  // Mask Bearer tokens
  masked = masked.replace(/Bearer\s+([A-Za-z0-9\-_~+/]+)/gi, 'Bearer [REDACTED]');
  
  return masked;
}

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'];

function sanitizeHeaders(headers: any): any {
  if (!headers) return headers;
  const safeHeaders: any = { ...headers };
  for (const key of Object.keys(safeHeaders)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      safeHeaders[key] = '[REDACTED]';
    }
  }
  return safeHeaders;
}

function sanitizeAxiosConfig(config: any): any {
  if (!config) return config;
  
  // Start with a minimal safe config to avoid copying circular references or functions
  const safeConfig: any = {
    url: maskSensitiveStrings(config.url),
    method: config.method,
    baseURL: maskSensitiveStrings(config.baseURL),
    timeout: config.timeout,
    maxRedirects: config.maxRedirects,
  };
  
  if (config.headers) {
    safeConfig.headers = sanitizeHeaders(config.headers);
  }
  
  // Clean URL params (e.g. access_token)
  if (config.params) {
    const safeParams = { ...config.params };
    for (const key of Object.keys(safeParams)) {
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')) {
        safeParams[key] = '[REDACTED]';
      }
    }
    safeConfig.params = safeParams;
  }
  
  return safeConfig;
}

/**
 * Specifically strips Axios request/response configs that hold sensitive data.
 */
export function sanitizeAxiosError(error: AxiosError): Error {
  // Create a new Error object to avoid mutating the original and dropping hidden properties
  const safeError: any = new Error(maskSensitiveStrings(error.message));
  safeError.name = error.name;
  safeError.code = error.code;
  safeError.isAxiosError = true;
  safeError.stack = error.stack ? maskSensitiveStrings(error.stack) : undefined;
  
  if (error.response) {
    safeError.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data, // Preserve body for Meta API errors
      headers: sanitizeHeaders(error.response.headers),
      config: sanitizeAxiosConfig(error.response.config),
    };
  }
  
  if (error.config) {
    safeError.config = sanitizeAxiosConfig(error.config);
  }
  
  if (error.request) {
    // The underlying HTTP request object (ClientRequest). Too dangerous to keep (has socket/TLS).
    safeError.request = {
      method: safeError.config?.method,
      path: safeError.config?.url,
      _sanitized: true,
    };
  }
  
  return safeError;
}

/**
 * Sanitizes an error object, ensuring no sensitive networking information
 * (proxy credentials, tokens, agent details) leaks.
 * Safe to be called on any error type.
 */
export function sanitizeError(error: unknown): Error {
  if (!error) return new Error('Unknown error');
  if (typeof error === 'string') return new Error(maskSensitiveStrings(error));
  
  if (axios.isAxiosError(error)) {
    return sanitizeAxiosError(error);
  }
  
  if (error instanceof Error) {
    // Basic error, try to strip sensitive strings if present in message/stack
    const safeError = new Error(maskSensitiveStrings(error.message));
    safeError.name = error.name;
    safeError.stack = error.stack ? maskSensitiveStrings(error.stack) : undefined;
    return safeError;
  }
  
  // For unknown objects, try to stringify safely
  let stringified;
  try {
    stringified = JSON.stringify(error);
  } catch (e) {
    stringified = String(error);
  }
  return new Error(maskSensitiveStrings(stringified));
}
