/**
 * Escrow contract interaction hooks.
 *
 * Transaction hooks use dApp Kit's signAndExecuteTransaction for wallet-mediated signing.
 * Data hooks use a JSON-RPC client for event queries (queryEvents) since the gRPC
 * transport used by dApp Kit lacks this endpoint. Object fetching also goes through
 * the JSON-RPC client for consistency.
 *
 * State is managed with useState + useEffect — no React Query dependency.
 */

import { useState, useEffect } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useDAppKit } from '@mysten/dapp-kit-react';
import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
  type SuiObjectResponse,
} from '@mysten/sui/jsonRpc';
import { PACKAGE_ID, CLOCK_ID } from '../constants';
import type { EscrowObject, EscrowCreatedEvent, ArbiterResolvedEvent, ChainEvent } from '../types';

// ── Constants ──────────────────────────────────────────────────────────────────

const SUI_COIN_TYPE = '0x2::coin::Coin<0x2::sui::SUI>';

/**
 * Module-level JSON-RPC client for event and object queries.
 * The gRPC client (useCurrentClient) doesn't expose queryEvents, so a separate
 * JSON-RPC transport is required for event-based discovery.
 */
const rpcClient = new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl('testnet'),
  network: 'testnet',
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Extract the generic type parameter T from a full `Escrow<T>` type string. */
function extractItemType(objectType: string): string {
  const marker = '::escrow::Escrow<';
  const start = objectType.indexOf(marker);
  if (start === -1) return SUI_COIN_TYPE;
  // Slice from after the marker to before the trailing '>'
  return objectType.slice(start + marker.length, -1);
}

/** Safely extract an object ID from a serialised Option<T> field. */
function extractItemId(field: unknown): string | null {
  if (field == null || typeof field !== 'object') return null;
  const obj = field as Record<string, unknown>;

  // Nested struct: { type, fields: { id: { id: "0x..." }, ... } }
  if (typeof obj.fields === 'object' && obj.fields != null) {
    const inner = (obj.fields as Record<string, unknown>).id;
    if (typeof inner === 'object' && inner != null) {
      return ((inner as Record<string, string>).id) ?? null;
    }
    if (typeof inner === 'string') return inner;
  }
  // Flat: { id: "0x..." }
  if (typeof obj.id === 'string') return obj.id;
  return null;
}

/** Parse a JSON-RPC object response into an `EscrowObject`. */
function parseEscrowObject(response: SuiObjectResponse): EscrowObject | null {
  if (response.error || !response.data?.content) return null;
  const { content } = response.data;
  if (content.dataType !== 'moveObject') return null;

  // MoveStruct for a struct is { [key: string]: MoveValue }
  const f = content.fields as Record<string, unknown>;
  const objectType = content.type;

  return {
    id: response.data.objectId,
    creator: f.creator as string,
    recipient: f.recipient as string,
    arbiter: f.arbiter as string,
    item: extractItemId(f.item),
    item_type: extractItemType(objectType),
    description: f.description as string,
    state: Number(f.state),
    creator_confirmed: Boolean(f.creator_confirmed),
    recipient_confirmed: Boolean(f.recipient_confirmed),
    created_at: Number(f.created_at),
    timeout_ms: Number(f.timeout_ms),
    disputed_at: Number(f.disputed_at),
  };
}

/** Wrap error coercion so every catch block stays concise. */
function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

// ── Transaction Hooks ──────────────────────────────────────────────────────────

/**
 * Build + sign a `create_and_share` tx that splits SUI from gas and escrows it.
 * typeArguments defaults to SUI Coin since this is the primary use-case.
 */
export function useCreateEscrow() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function execute(params: {
    amountInMist: bigint | number;
    recipient: string;
    arbiter: string;
    description: string;
    timeoutMs: bigint | number;
  }) {
    setLoading(true);
    setError(null);
    try {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [params.amountInMist]);
      tx.moveCall({
        target: `${PACKAGE_ID}::escrow::create_and_share`,
        typeArguments: [SUI_COIN_TYPE],
        arguments: [
          coin,
          tx.pure.address(params.recipient),
          tx.pure.address(params.arbiter),
          tx.pure.string(params.description),
          tx.pure.u64(params.timeoutMs),
          tx.object(CLOCK_ID),
        ],
      });
      return await dAppKit.signAndExecuteTransaction({ transaction: tx });
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { execute, loading, error };
}

/** Confirm the deal (creator or recipient). Both confirmations auto-release. */
export function useConfirmEscrow() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function execute(escrowId: string, itemType = SUI_COIN_TYPE) {
    setLoading(true);
    setError(null);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::escrow::confirm`,
        typeArguments: [itemType],
        arguments: [tx.object(escrowId)],
      });
      return await dAppKit.signAndExecuteTransaction({ transaction: tx });
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { execute, loading, error };
}

/** Raise a dispute; requires Clock to record disputed_at timestamp. */
export function useDisputeEscrow() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function execute(escrowId: string, itemType = SUI_COIN_TYPE) {
    setLoading(true);
    setError(null);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::escrow::dispute`,
        typeArguments: [itemType],
        arguments: [tx.object(escrowId), tx.object(CLOCK_ID)],
      });
      return await dAppKit.signAndExecuteTransaction({ transaction: tx });
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { execute, loading, error };
}

/** Recipient voluntarily declines, returning the asset to creator. */
export function useRejectEscrow() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function execute(escrowId: string, itemType = SUI_COIN_TYPE) {
    setLoading(true);
    setError(null);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::escrow::reject`,
        typeArguments: [itemType],
        arguments: [tx.object(escrowId)],
      });
      return await dAppKit.signAndExecuteTransaction({ transaction: tx });
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { execute, loading, error };
}

/** Arbiter resolves a disputed escrow (release to recipient or refund creator). */
export function useArbiterResolve() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function execute(
    escrowId: string,
    releaseToRecipient: boolean,
    itemType = SUI_COIN_TYPE,
  ) {
    setLoading(true);
    setError(null);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::escrow::arbiter_resolve`,
        typeArguments: [itemType],
        arguments: [tx.object(escrowId), tx.pure.bool(releaseToRecipient)],
      });
      return await dAppKit.signAndExecuteTransaction({ transaction: tx });
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { execute, loading, error };
}

/** Creator reclaims asset after timeout (Active) or arbiter-unreachable (Disputed). */
export function useTimelockRefund() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function execute(escrowId: string, itemType = SUI_COIN_TYPE) {
    setLoading(true);
    setError(null);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::escrow::timelock_refund`,
        typeArguments: [itemType],
        arguments: [tx.object(escrowId), tx.object(CLOCK_ID)],
      });
      return await dAppKit.signAndExecuteTransaction({ transaction: tx });
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { execute, loading, error };
}

/** Destroy a terminal-state escrow (Released/Refunded) to reclaim on-chain storage. */
export function useDestroyEscrow() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function execute(escrowId: string, itemType = SUI_COIN_TYPE) {
    setLoading(true);
    setError(null);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::escrow::destroy`,
        typeArguments: [itemType],
        // By-value shared object consumption
        arguments: [tx.object(escrowId)],
      });
      return await dAppKit.signAndExecuteTransaction({ transaction: tx });
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { execute, loading, error };
}

// ── Data Hooks ─────────────────────────────────────────────────────────────────

/**
 * Discover escrows where `address` participates (as creator, recipient, or
 * arbiter) by querying `EscrowCreated` events, then batch-fetch current state.
 *
 * Destroyed objects are gracefully filtered out (multiGetObjects returns an
 * error entry for deleted objects).
 */
export function useMyEscrows(address: string | undefined) {
  const [data, setData] = useState<EscrowObject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }

    const targetAddress = address;
    let cancelled = false;

    async function fetchEscrows() {
      setLoading(true);
      setError(null);
      try {
        // 1. Discover escrow IDs via EscrowCreated events
        const eventsPage = await rpcClient.queryEvents({
          query: { MoveEventType: `${PACKAGE_ID}::escrow::EscrowCreated` },
          limit: 50,
          order: 'descending',
        });

        // 2. Filter to escrows where the user is a participant
        const relevantIds = eventsPage.data
          .filter((evt) => {
            const json = evt.parsedJson as EscrowCreatedEvent;
            return (
              json.creator === targetAddress ||
              json.recipient === targetAddress ||
              json.arbiter === targetAddress
            );
          })
          .map((evt) => (evt.parsedJson as EscrowCreatedEvent).escrow_id);

        const uniqueIds = [...new Set(relevantIds)];

        if (uniqueIds.length === 0) {
          if (!cancelled) setData([]);
          return;
        }

        // 3. Batch-fetch current object states
        const objectResponses = await rpcClient.multiGetObjects({
          ids: uniqueIds,
          options: { showContent: true, showType: true },
        });

        // 4. Parse; destroyed objects return null and are filtered out
        const escrows = objectResponses
          .map(parseEscrowObject)
          .filter((e): e is EscrowObject => e !== null);

        if (!cancelled) setData(escrows);
      } catch (e) {
        if (!cancelled) setError(toError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEscrows();
    return () => {
      cancelled = true;
    };
  }, [address, fetchTrigger]);

  function refetch() {
    setFetchTrigger((n) => n + 1);
  }

  return { data, loading, error, refetch };
}

// ── Arbiter Stats ──────────────────────────────────────────────────────────────

export interface ArbiterStats {
  total: number;
  released: number;
  refunded: number;
}

/**
 * Aggregate resolution statistics for an arbiter by querying `ArbiterResolved`
 * events and filtering client-side by address. Non-critical — silently returns
 * null on failure so the rest of the page remains functional.
 */
export function useArbiterStats(address: string | undefined) {
  const [data, setData] = useState<ArbiterStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }

    const target = address;
    let cancelled = false;

    async function fetchStats() {
      setLoading(true);
      try {
        const eventsPage = await rpcClient.queryEvents({
          query: { MoveEventType: `${PACKAGE_ID}::escrow::ArbiterResolved` },
          limit: 50,
          order: 'descending',
        });

        const mine = eventsPage.data.filter(
          (evt) => (evt.parsedJson as ArbiterResolvedEvent).arbiter === target,
        );

        const stats: ArbiterStats = {
          total: mine.length,
          released: mine.filter((evt) => (evt.parsedJson as ArbiterResolvedEvent).released).length,
          refunded: mine.filter((evt) => !(evt.parsedJson as ArbiterResolvedEvent).released).length,
        };

        if (!cancelled) setData(stats);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { data, loading };
}

/**
 * Fetch a single escrow's current state and its full event timeline.
 *
 * When the escrow has been destroyed, `escrow` is null and `destroyed` is true;
 * the event timeline remains available for degraded rendering.
 */
export function useEscrowDetail(escrowId: string | undefined) {
  const [escrow, setEscrow] = useState<EscrowObject | null>(null);
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [destroyed, setDestroyed] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    if (!escrowId) return;

    const id = escrowId;
    let cancelled = false;

    async function fetchDetail() {
      setLoading(true);
      setError(null);
      try {
        // Fetch object state (may be destroyed)
        const objResponse = await rpcClient.getObject({
          id,
          options: { showContent: true, showType: true },
        });

        if (!cancelled) {
          if (objResponse.error) {
            setDestroyed(true);
            setEscrow(null);
          } else {
            setDestroyed(false);
            setEscrow(parseEscrowObject(objResponse));
          }
        }

        // Query all events from the escrow module, then filter by this ID
        const eventsPage = await rpcClient.queryEvents({
          query: { MoveModule: { package: PACKAGE_ID, module: 'escrow' } },
          limit: 100,
          order: 'ascending',
        });

        const timeline: ChainEvent[] = eventsPage.data
          .filter((evt) => {
            const json = evt.parsedJson as Record<string, unknown>;
            return json.escrow_id === id;
          })
          .map((evt) => ({
            type: evt.type,
            timestamp: Number(evt.timestampMs ?? 0),
            sender: evt.sender,
            parsedJson: evt.parsedJson as Record<string, unknown>,
          }));

        if (!cancelled) setEvents(timeline);
      } catch (e) {
        if (!cancelled) setError(toError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDetail();
    return () => {
      cancelled = true;
    };
  }, [escrowId, fetchTrigger]);

  function refetch() {
    setFetchTrigger((n) => n + 1);
  }

  return { escrow, events, loading, error, destroyed, refetch };
}
