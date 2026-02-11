// ── Escrow Object (mirrors on-chain Escrow<T> struct) ──

export interface EscrowObject {
  id: string;
  creator: string;
  recipient: string;
  arbiter: string;
  /** Object ID of the escrowed asset, null after release/refund */
  item: string | null;
  /** Move type tag of the escrowed asset (extracted from object type) */
  item_type: string;
  description: string;
  /** Numeric state: 0=Active, 1=Disputed, 2=Released, 3=Refunded */
  state: number;
  creator_confirmed: boolean;
  recipient_confirmed: boolean;
  /** Epoch-ms timestamp when the escrow was created */
  created_at: number;
  /** Duration in ms before timelock refund becomes available */
  timeout_ms: number;
  /** Epoch-ms timestamp when dispute was raised (0 = not disputed) */
  disputed_at: number;
}

// ── Swap Object (mirrors on-chain Swap<T, phantom U> struct) ──

export interface SwapObject {
  id: string;
  creator: string;
  recipient: string;
  /** Object ID of the creator's deposited asset, null after execute/cancel */
  item_a: string | null;
  /** Move type tag of T (creator's asset), extracted from object type */
  item_a_type: string;
  /** Move type tag of U (expected counter-asset), extracted from phantom param */
  item_b_type: string;
  description: string;
  /** Numeric state: 0=Pending, 1=Executed, 2=Cancelled */
  state: number;
  /** Epoch-ms timestamp when the swap was created */
  created_at: number;
  /** Duration in ms before creator can cancel */
  timeout_ms: number;
}

// ── Escrow Events (match contract Move structs) ──

export interface EscrowCreatedEvent {
  escrow_id: string;
  creator: string;
  recipient: string;
  arbiter: string;
  description: string;
  timeout_ms: string;
  item_id: string;
}

export interface EscrowConfirmedEvent {
  escrow_id: string;
  confirmer: string;
}

export interface EscrowReleasedEvent {
  escrow_id: string;
  recipient: string;
}

export interface EscrowRefundedEvent {
  escrow_id: string;
  creator: string;
}

export interface EscrowDisputedEvent {
  escrow_id: string;
  disputer: string;
}

export interface EscrowRejectedEvent {
  escrow_id: string;
  recipient: string;
}

export interface ArbiterResolvedEvent {
  escrow_id: string;
  arbiter: string;
  released: boolean;
}

export interface EscrowDestroyedEvent {
  escrow_id: string;
  destroyed_by: string;
}

export type EscrowEvent =
  | EscrowCreatedEvent
  | EscrowConfirmedEvent
  | EscrowReleasedEvent
  | EscrowRefundedEvent
  | EscrowDisputedEvent
  | EscrowRejectedEvent
  | ArbiterResolvedEvent
  | EscrowDestroyedEvent;

// ── Swap Events (match contract Move structs) ──

export interface SwapCreatedEvent {
  swap_id: string;
  creator: string;
  recipient: string;
  description: string;
  timeout_ms: string;
  created_at: string;
}

export interface SwapExecutedEvent {
  swap_id: string;
  creator: string;
  recipient: string;
}

export interface SwapCancelledEvent {
  swap_id: string;
  creator: string;
}

export interface SwapDestroyedEvent {
  swap_id: string;
  destroyed_by: string;
}

export type SwapEvent =
  | SwapCreatedEvent
  | SwapExecutedEvent
  | SwapCancelledEvent
  | SwapDestroyedEvent;

// ── Shared Utilities ──

/** Parsed on-chain event with metadata from queryEvents response */
export interface ChainEvent {
  type: string;
  timestamp: number;
  sender: string;
  parsedJson: Record<string, unknown>;
}

/** Generic async-data state used by custom hooks */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}
