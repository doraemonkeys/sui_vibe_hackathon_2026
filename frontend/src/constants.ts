export const PACKAGE_ID =
  '0xf03f9338e341f9d3c58fdfeebc7c808c3dce7ce7f2b01a87dc7d3021b9a0967e';

/** Sui shared Clock object */
export const CLOCK_ID = '0x6';

// ── Escrow states (match contract enum encoding) ──
export const ESCROW_STATE_ACTIVE = 0;
export const ESCROW_STATE_DISPUTED = 1;
export const ESCROW_STATE_RELEASED = 2;
export const ESCROW_STATE_REFUNDED = 3;

// ── Swap states (match contract enum encoding) ──
export const SWAP_STATE_PENDING = 0;
export const SWAP_STATE_EXECUTED = 1;
export const SWAP_STATE_CANCELLED = 2;
