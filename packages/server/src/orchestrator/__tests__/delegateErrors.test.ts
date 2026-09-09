import { describe, it, expect } from 'vitest';
import { classifyDelegateError } from '../delegateErrors.js';
import { LitellmHttpError } from '../litellmClient.js';

describe('classifyDelegateError', () => {
  it('shelves a rate-limited model for the window it reported', () => {
    const v = classifyDelegateError(
      new LitellmHttpError(429, 'litellm.RateLimitError: 5-hour usage limit reached. Resets in 50min.'),
    );
    expect(v.retryable).toBe(true);
    expect(v.cooldownMs).toBe(50 * 60_000);
  });

  // A bad key fails identically on every model — walking the chain buys nothing.
  it('stops the chain on an auth failure', () => {
    expect(classifyDelegateError(new LitellmHttpError(401, 'invalid api key')).retryable).toBe(false);
    expect(classifyDelegateError(new LitellmHttpError(403, 'forbidden')).retryable).toBe(false);
  });

  it('shelves a retired model id but not a request the model merely refused', () => {
    const retired = classifyDelegateError(new LitellmHttpError(400, 'Invalid model name passed in'));
    expect(retired.retryable).toBe(true);
    expect(retired.cooldownMs).toBeGreaterThan(0);

    const tooLong = classifyDelegateError(new LitellmHttpError(400, 'context window exceeded: 900000 tokens'));
    expect(tooLong.retryable).toBe(true);
    expect(tooLong.cooldownMs).toBeUndefined();
  });

  it('retries gateway faults without remembering them', () => {
    for (const status of [500, 502, 503, 408]) {
      const v = classifyDelegateError(new LitellmHttpError(status, 'upstream error'));
      expect(v.retryable, String(status)).toBe(true);
      expect(v.cooldownMs).toBeUndefined();
    }
  });

  it('retries timeouts and network errors', () => {
    const v = classifyDelegateError(new Error('The operation was aborted due to timeout'));
    expect(v.retryable).toBe(true);
    expect(v.message).toContain('timeout');
  });

  // A pinned id the key may no longer use (a retired preview) answers 403, and
  // every delegation that names no model started there — the chain must survive it.
  it('treats a blocked model as one model failing, not the key', () => {
    const v = classifyDelegateError(
      new LitellmHttpError(403, '{"error":{"message":"litellm.PermissionDeniedError: Model is blocked"}}'),
    );
    expect(v.retryable).toBe(true);
    expect(v.cooldownMs).toBe(60 * 60_000);
  });

  it('still stops the chain on a 403 that is not about the model', () => {
    expect(classifyDelegateError(new LitellmHttpError(403, 'Forbidden')).retryable).toBe(false);
  });
});
