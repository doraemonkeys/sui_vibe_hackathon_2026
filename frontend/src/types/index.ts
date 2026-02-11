// ── Escrow Types ──

export interface EscrowFields {
  id: string;
  creator: string;
  recipient: string;
  arbiter: string;
  description: string;
  state: number;
  creator_confirmed: boolean;
  recipient_confirmed: boolean;
  created_at: number;
  timeout_ms: number;
  disputed_at: number | null;
  arbiter_timeout_ms: number;
}

// ── Swap Types ──

export interface SwapFields {
  id: string;
  creator: string;
  recipient: string;
  description: string;
  state: number;
  created_at: number;
  timeout_ms: number;
  item_a_type: string;
  item_b_type: string;
}

// ── Shared ──

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
