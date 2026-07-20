import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeIndianPhone } from '../src/worker/util/phone';

describe('Indian phone normalization', () => {
  it('normalizes all common input shapes to E.164', () => {
    for (const input of [
      '9876543210',
      '09876543210',
      '919876543210',
      '+919876543210',
      '+91 98765 43210',
      '98765-43210',
      '(+91) 98765 43210',
    ]) {
      expect(normalizeIndianPhone(input)).toBe('+919876543210');
    }
  });

  it('rejects invalid numbers', () => {
    for (const input of [
      '12345',
      '5876543210', // mobiles start 6-9
      '98765432101',
      '+1 555 0100 000',
      'abcdefghij',
      '',
      null,
      42,
    ]) {
      expect(normalizeIndianPhone(input)).toBeNull();
    }
  });

  it('masks numbers for display and logs', () => {
    expect(maskPhone('+919876543210')).toBe('+91••••••210');
    expect(maskPhone('+919876543210')).not.toContain('98765');
  });
});
