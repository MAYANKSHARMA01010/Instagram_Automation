import { classifyError, ErrorCategory } from '../../src/utils/error-classifier';

describe('Error Classifier Utility', () => {
  it('classifies ECONNREFUSED as INFRASTRUCTURE', () => {
    expect(classifyError('Failed with ECONNREFUSED')).toBe(ErrorCategory.INFRASTRUCTURE);
    expect(classifyError({ code: 'ECONNREFUSED' })).toBe(ErrorCategory.INFRASTRUCTURE);
  });

  it('classifies Proxy 407 Auth as INFRASTRUCTURE', () => {
    expect(classifyError('Proxy Auth 407 Required')).toBe(ErrorCategory.INFRASTRUCTURE);
  });

  it('classifies Action Blocked as RATE_LIMIT', () => {
    expect(classifyError('Action_Blocked by Meta')).toBe(ErrorCategory.RATE_LIMIT);
  });

  it('classifies Checkpoint Required as PLATFORM', () => {
    expect(classifyError('checkpoint_required')).toBe(ErrorCategory.PLATFORM);
  });

  it('classifies Session Expired as AUTH', () => {
    expect(classifyError('session_expired for user')).toBe(ErrorCategory.AUTH);
  });

  it('classifies Unknown Errors correctly', () => {
    expect(classifyError('something completely different')).toBe(ErrorCategory.UNKNOWN);
  });
});
