import { describe, it, expect } from 'vitest';
import {
  PACKAGE_ID,
  CLOCK_ID,
  ESCROW_STATE_ACTIVE,
  ESCROW_STATE_DISPUTED,
  ESCROW_STATE_RELEASED,
  ESCROW_STATE_REFUNDED,
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from './constants';

describe('constants', () => {
  it('exports a placeholder package ID', () => {
    expect(typeof PACKAGE_ID).toBe('string');
    expect(PACKAGE_ID.startsWith('0x')).toBe(true);
  });

  it('exports the Sui shared Clock object ID', () => {
    expect(CLOCK_ID).toBe('0x6');
  });

  describe('escrow states are distinct sequential integers', () => {
    const states = [
      ESCROW_STATE_ACTIVE,
      ESCROW_STATE_DISPUTED,
      ESCROW_STATE_RELEASED,
      ESCROW_STATE_REFUNDED,
    ];

    it('has 4 unique values', () => {
      expect(new Set(states).size).toBe(4);
    });

    it('starts at 0 and increments by 1', () => {
      states.forEach((s, i) => expect(s).toBe(i));
    });
  });

  describe('swap states are distinct sequential integers', () => {
    const states = [
      SWAP_STATE_PENDING,
      SWAP_STATE_EXECUTED,
      SWAP_STATE_CANCELLED,
    ];

    it('has 3 unique values', () => {
      expect(new Set(states).size).toBe(3);
    });

    it('starts at 0 and increments by 1', () => {
      states.forEach((s, i) => expect(s).toBe(i));
    });
  });
});
