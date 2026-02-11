export const PACKAGE_ID =
  '0xeb07c23fc18e231f4632e812961b939f3fd788dbae887e2470d8697a191085b6';

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
