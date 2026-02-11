/** Update after contract deployment to testnet */
export const PACKAGE_ID = '0xTODO';

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
