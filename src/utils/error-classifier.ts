export enum ErrorCategory {
  PLATFORM = 'PlatformError',
  INFRASTRUCTURE = 'InfrastructureError',
  AUTH = 'AuthError',
  RATE_LIMIT = 'RateLimitError',
  VALIDATION = 'ValidationError',
  UNKNOWN = 'UnknownError',
}

/**
 * Categorizes an error based on its message or code.
 * Reusable utility that prevents scattering string checks.
 */
export function classifyError(error: unknown): ErrorCategory {
  const message = typeof error === 'string' ? error.toLowerCase() : (error as Error)?.message?.toLowerCase() ?? '';
  const code = (error as any)?.code?.toLowerCase() ?? '';

  // 1. Infrastructure Errors (Proxy, DNS, Socket, TCP)
  if ((error as any)?.isInfrastructureError) {
    return ErrorCategory.INFRASTRUCTURE;
  }
  
  const infraKeywords = [
    'econnrefused',
    'econnreset',
    'etimedout',
    'enotfound',
    'eai_again',
    'socket hang up',
    'tls handshake',
    'proxy auth',
    '407',
    'timeout',
    'network',
  ];
  if (infraKeywords.some((kw) => message.includes(kw) || code.includes(kw))) {
    return ErrorCategory.INFRASTRUCTURE;
  }

  // 2. Auth Errors
  const authKeywords = ['token', 'oauth', 'auth', 'login_required', 'session_expired'];
  if (authKeywords.some((kw) => message.includes(kw) || code.includes(kw))) {
    return ErrorCategory.AUTH;
  }

  // 3. Rate Limit / Quota
  const rateLimitKeywords = [
    'rate limit',
    'too many calls',
    'throttled',
    'user access is restricted',
    'action_blocked',
    'action blocked',
  ];
  if (rateLimitKeywords.some((kw) => message.includes(kw) || code.includes(kw))) {
    return ErrorCategory.RATE_LIMIT;
  }

  // 4. Platform / Meta Errors
  const platformKeywords = [
    'checkpoint_required',
    'challenge_required',
    'feedback_required',
    'not permitted',
    'meta api error',
  ];
  if (platformKeywords.some((kw) => message.includes(kw) || code.includes(kw))) {
    return ErrorCategory.PLATFORM;
  }

  // 5. Validation Errors
  if (message.includes('validation') || message.includes('invalid')) {
    return ErrorCategory.VALIDATION;
  }

  return ErrorCategory.UNKNOWN;
}
