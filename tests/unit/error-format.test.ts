import { describe, it, expect } from 'vitest';
import { formatErrorWithCause } from '../../src/lib/errors.js';

describe('formatErrorWithCause', () => {
  it('returns clean error message and strips params when no cause is present', () => {
    const err = new Error(
      'Failed query: select * from users where id = $1\nparams: ["sensitive_user_id"]',
    );
    const result = formatErrorWithCause(err);
    expect(result).toBe('Failed query: select * from users where id = $1');
    expect(result).not.toContain('params');
    expect(result).not.toContain('sensitive_user_id');
  });

  it('appends cause message and strips params from both message and cause', () => {
    const err = new Error(
      'Failed query: insert into corporate_numbers values ($1, $2)\nparams: ["1234567890123", "Secret Corp"]',
    );
    err.cause = new Error(
      'permission denied for table corporate_numbers\nparams: ["1234567890123"]',
    );

    const result = formatErrorWithCause(err);
    expect(result).toBe(
      'Failed query: insert into corporate_numbers values ($1, $2) / cause: permission denied for table corporate_numbers',
    );
    expect(result).not.toContain('params:');
    expect(result).not.toContain('1234567890123');
    expect(result).not.toContain('Secret Corp');
  });

  it('ignores non-Error cause', () => {
    const err = new Error('Database connection lost\nparams: [1, 2]');
    err.cause = 'plain string cause';

    const result = formatErrorWithCause(err);
    expect(result).toBe('Database connection lost');
    expect(result).not.toContain('cause:');
  });

  it('uses fallbackMessage if err is not an Error', () => {
    expect(formatErrorWithCause('custom failure string')).toBe('custom failure string');
    expect(formatErrorWithCause(null, 'fallback default')).toBe('fallback default');
  });
});
