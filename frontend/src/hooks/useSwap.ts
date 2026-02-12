/**
 * Swap contract interaction hooks.
 *
 * Transaction hooks use useDAppKit() for signing.
 * Data-fetching hooks use useCurrentClient() for object queries and
 * JSON-RPC for event queries — the gRPC transport in @mysten/sui v2
 * does not expose a queryEvents API, but every Sui fullnode also
 * serves the JSON-RPC protocol on the same host.
 */

import { useState, useEffect, useCallback } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useDAppKit, useCurrentClient } from '@mysten/dapp-kit-react';
import {
  PACKAGE_ID,
  CLOCK_ID,
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from '../constants';
import type { SwapObject, ChainEvent } from '../types';
import { extractTypeParams } from '../utils/parseSwapTypeArgs';

// ── Module constants ────────────────────────────────────────────────

const SWAP_MODULE = `${PACKAGE_ID}::swap`;

/**
 * Sui testnet JSON-RPC endpoint.
 * Used exclusively for event queries that the gRPC transport cannot serve.
 */
const JSON_RPC_URL = 'https://fullnode.testnet.sui.io:443';

const EVENT_TYPES = {
  created: `${SWAP_MODULE}::SwapCreated`,
  executed: `${SWAP_MODULE}::SwapExecuted`,
  cancelled: `${SWAP_MODULE}::SwapCancelled`,
  destroyed: `${SWAP_MODULE}::SwapDestroyed`,
} as const;

// ── JSON-RPC event helpers ──────────────────────────────────────────

interface RpcEventCursor {
  txDigest: string;
  eventSeq: string;
}

interface RpcEvent {
  type: string;
  sender: string;
  timestampMs: string;
  parsedJson: Record<string, unknown>;
}

interface RpcEventsPage {
  data: RpcEvent[];
  nextCursor: RpcEventCursor | null;
  hasNextPage: boolean;
}

async function rpcQueryEvents(
  eventType: string,
  cursor: RpcEventCursor | null = null,
  limit = 50,
): Promise<RpcEventsPage> {
  const res = await fetch(JSON_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_queryEvents',
      params: [{ MoveEventType: eventType }, cursor, limit, false],
    }),
  });
  const body = (await res.json()) as {
    result?: RpcEventsPage;
    error?: { message: string };
  };
  if (body.error) throw new Error(body.error.message);
  if (!body.result) throw new Error('Empty JSON-RPC response');
  return body.result;
}

/** Paginate through every page of a given MoveEventType. */
async function rpcQueryAllEvents(eventType: string): Promise<RpcEvent[]> {
  const all: RpcEvent[] = [];
  let cursor: RpcEventCursor | null = null;
  let hasNext = true;
  while (hasNext) {
    const page = await rpcQueryEvents(eventType, cursor);
    all.push(...page.data);
    cursor = page.nextCursor;
    hasNext = page.hasNextPage;
  }
  return all;
}

// ── Object parsing helpers ──────────────────────────────────────────

/** Map the gRPC object JSON representation into our domain model. */
function parseSwapJson(
  objectId: string,
  objectType: string,
  json: Record<string, unknown> | null,
): SwapObject | null {
  if (!json) return null;
  const [itemType = '', coinType = ''] = extractTypeParams(objectType);

  // item is Option<T> — may be null, a string ID, or a nested UID struct
  let item: string | null = null;
  const raw = json.item;
  if (raw != null) {
    if (typeof raw === 'string') {
      item = raw;
    } else if (typeof raw === 'object') {
      const nested = raw as Record<string, unknown>;
      const uid = nested.id;
      if (uid && typeof uid === 'object') {
        item = ((uid as Record<string, unknown>).id as string) ?? null;
      } else if (typeof uid === 'string') {
        item = uid;
      }
    }
  }

  return {
    id: objectId,
    creator: json.creator as string,
    recipient: json.recipient as string,
    item,
    requested_amount: String(json.requested_amount ?? '0'),
    description: json.description as string,
    state: Number(json.state),
    created_at: Number(json.created_at),
    timeout_ms: Number(json.timeout_ms),
    item_type: itemType,
    coin_type: coinType,
  };
}

/**
 * Reconstruct a minimal SwapObject from the creation event when the
 * on-chain object has already been destroyed.
 */
function swapFromCreationEvent(swapId: string, ev: RpcEvent, state: number): SwapObject {
  const pj = ev.parsedJson;
  return {
    id: swapId,
    creator: pj.creator as string,
    recipient: pj.recipient as string,
    item: null,
    requested_amount: String(pj.requested_amount ?? '0'),
    description: pj.description as string,
    state,
    created_at: Number(pj.created_at ?? ev.timestampMs),
    timeout_ms: Number(pj.timeout_ms),
    item_type: '',
    coin_type: '',
  };
}

function toChainEvent(ev: RpcEvent): ChainEvent {
  return {
    type: ev.type,
    timestamp: Number(ev.timestampMs),
    sender: ev.sender,
    parsedJson: ev.parsedJson,
  };
}

/** Derive terminal state from executed / cancelled event sets. */
function inferTerminalState(
  swapId: string,
  executedIds: ReadonlySet<string>,
  cancelledIds: ReadonlySet<string>,
): number {
  if (executedIds.has(swapId)) return SWAP_STATE_EXECUTED;
  if (cancelledIds.has(swapId)) return SWAP_STATE_CANCELLED;
  return SWAP_STATE_PENDING;
}

// ── Transaction hooks ───────────────────────────────────────────────

interface CreateSwapParams {
  /** Move type tag of T — the asset the creator deposits (e.g. an NFT type). */
  itemType: string;
  /** Inner coin type the creator wants in return (e.g. `0x2::sui::SUI`). NOT `Coin<X>`. */
  coinType: string;
  recipient: string;
  /** Minimum payment in the smallest unit (MIST for SUI). */
  requestedAmount: bigint | string;
  description: string;
  timeoutMs: number;
  /** Object ID of the creator's asset to deposit. */
  assetObjectId: string;
}

/**
 * Build & sign a `swap::create_swap` transaction.
 *
 * TypeArguments: `[T, CoinType]` where T = creator's deposited asset,
 * CoinType = inner type of the Coin the creator expects (e.g. `0x2::sui::SUI`).
 */
export function useCreateSwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: CreateSwapParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${SWAP_MODULE}::create_swap`,
          typeArguments: [params.itemType, params.coinType],
          arguments: [
            tx.object(params.assetObjectId),
            tx.pure.address(params.recipient),
            tx.pure.u64(params.requestedAmount),
            tx.pure.string(params.description),
            tx.pure.u64(params.timeoutMs),
            tx.object(CLOCK_ID),
          ],
        });

        await dAppKit.signAndExecuteTransaction({ transaction: tx });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [dAppKit],
  );

  return { execute, loading, error };
}

interface ExecuteSwapParams {
  swapObjectId: string;
  /** Move type tag of T — the creator's deposited asset type. */
  itemType: string;
  /** Inner coin type (e.g. `0x2::sui::SUI`). NOT `Coin<X>`. */
  coinType: string;
  /** Payment amount in smallest unit (MIST for SUI). Must be >= swap's requested_amount. */
  paymentAmount: bigint | string;
}

/**
 * Build & sign a `swap::execute_swap` transaction.
 *
 * Recipient pays with Coin<CoinType>, completing the atomic exchange.
 * Hackathon scope: SUI-only — splits payment directly from gas coin.
 */
export function useExecuteSwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: ExecuteSwapParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();

        const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(params.paymentAmount)]);

        tx.moveCall({
          target: `${SWAP_MODULE}::execute_swap`,
          typeArguments: [params.itemType, params.coinType],
          arguments: [tx.object(params.swapObjectId), payment],
        });

        await dAppKit.signAndExecuteTransaction({ transaction: tx });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [dAppKit],
  );

  return { execute, loading, error };
}

interface SwapIdParams {
  swapObjectId: string;
  /** Move type tag of T — the creator's deposited asset type. */
  itemType: string;
  /** Inner coin type (e.g. `0x2::sui::SUI`). NOT `Coin<X>`. */
  coinType: string;
}

/**
 * Build & sign a `swap::cancel_swap` transaction.
 * Creator reclaims their asset after timeout. Requires Clock.
 */
export function useCancelSwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: SwapIdParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${SWAP_MODULE}::cancel_swap`,
          typeArguments: [params.itemType, params.coinType],
          arguments: [tx.object(params.swapObjectId), tx.object(CLOCK_ID)],
        });
        await dAppKit.signAndExecuteTransaction({ transaction: tx });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [dAppKit],
  );

  return { execute, loading, error };
}

/**
 * Build & sign a `swap::destroy_swap` transaction.
 * Reclaims on-chain storage for a terminated (Executed / Cancelled) swap.
 * Consumes the shared object by value.
 */
export function useDestroySwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: SwapIdParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${SWAP_MODULE}::destroy_swap`,
          typeArguments: [params.itemType, params.coinType],
          arguments: [tx.object(params.swapObjectId)],
        });
        await dAppKit.signAndExecuteTransaction({ transaction: tx });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [dAppKit],
  );

  return { execute, loading, error };
}

// ── Data-fetching hooks ─────────────────────────────────────────────

/**
 * Fetch all swaps where `address` is creator or recipient.
 *
 * 1. Query SwapCreated events via JSON-RPC
 * 2. Filter by address matching creator or recipient
 * 3. Batch-fetch live object state via gRPC `getObjects`
 * 4. Query SwapExecuted / SwapCancelled for terminal-state tagging
 * 5. Gracefully handle destroyed objects via event-driven fallback
 */
export function useMySwaps(address: string | undefined) {
  const client = useCurrentClient();
  const [data, setData] = useState<SwapObject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchSwaps = useCallback(async () => {
    if (!address) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const createdEvents = await rpcQueryAllEvents(EVENT_TYPES.created);

      const mine = createdEvents.filter(
        (ev) => ev.parsedJson.creator === address || ev.parsedJson.recipient === address,
      );

      if (mine.length === 0) {
        setData([]);
        return;
      }

      const swapIds = [...new Set(mine.map((ev) => ev.parsedJson.swap_id as string))];

      // Batch-fetch live objects via gRPC
      const objectsRes = await client.getObjects({
        objectIds: swapIds,
        include: { json: true },
      });

      // Terminal-state event sets for destroyed-object fallback
      const [executedEvs, cancelledEvs] = await Promise.all([
        rpcQueryAllEvents(EVENT_TYPES.executed),
        rpcQueryAllEvents(EVENT_TYPES.cancelled),
      ]);
      const executedIds = new Set(executedEvs.map((e) => e.parsedJson.swap_id as string));
      const cancelledIds = new Set(cancelledEvs.map((e) => e.parsedJson.swap_id as string));

      const swaps: SwapObject[] = [];
      for (let i = 0; i < swapIds.length; i++) {
        const id = swapIds[i];
        const obj = objectsRes.objects[i];

        if (obj instanceof Error) {
          // Object destroyed — reconstruct from creation event
          const ev = mine.find((e) => e.parsedJson.swap_id === id);
          if (ev) {
            swaps.push(
              swapFromCreationEvent(id, ev, inferTerminalState(id, executedIds, cancelledIds)),
            );
          }
          continue;
        }

        const parsed = parseSwapJson(obj.objectId, obj.type, obj.json ?? null);
        if (parsed) swaps.push(parsed);
      }

      setData(swaps);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [address, client]);

  useEffect(() => {
    fetchSwaps();
  }, [fetchSwaps]);

  return { data, loading, error, refetch: fetchSwaps };
}

/**
 * Fetch a single Swap object together with all related events for timeline.
 *
 * When the object has been destroyed (`getObject` throws), the hook
 * falls back to event-driven rendering: it reconstructs a partial
 * SwapObject from the creation event and infers terminal state from
 * executed / cancelled events.
 */
export function useSwapDetail(swapId: string | undefined) {
  const client = useCurrentClient();
  const [data, setData] = useState<SwapObject | null>(null);
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!swapId) {
      setData(null);
      setEvents([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Collect all event types for this swap ID
      const allEvs = (await Promise.all(Object.values(EVENT_TYPES).map(rpcQueryAllEvents))).flat();

      const related = allEvs
        .filter((ev) => ev.parsedJson.swap_id === swapId)
        .sort((a, b) => Number(a.timestampMs) - Number(b.timestampMs));

      setEvents(related.map(toChainEvent));

      // Try fetching the live object
      let swap: SwapObject | null = null;
      try {
        const res = await client.getObject({
          objectId: swapId,
          include: { json: true },
        });
        swap = parseSwapJson(res.object.objectId, res.object.type, res.object.json ?? null);
      } catch {
        // Object destroyed — fall back to event reconstruction
        const creationEv = related.find((ev) => ev.type.endsWith('::SwapCreated'));
        if (creationEv) {
          const hasExecuted = related.some((ev) => ev.type.endsWith('::SwapExecuted'));
          const hasCancelled = related.some((ev) => ev.type.endsWith('::SwapCancelled'));
          let state = SWAP_STATE_PENDING;
          if (hasExecuted) state = SWAP_STATE_EXECUTED;
          else if (hasCancelled) state = SWAP_STATE_CANCELLED;

          swap = swapFromCreationEvent(swapId, creationEv, state);
        }
      }

      setData(swap);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [swapId, client]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return { data, events, loading, error, refetch: fetchDetail };
}
