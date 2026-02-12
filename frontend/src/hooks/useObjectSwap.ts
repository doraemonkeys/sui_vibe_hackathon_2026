/**
 * ObjectSwap contract interaction hooks.
 *
 * Mirrors the structure of useSwap.ts but targets the `gavel::object_swap`
 * module for NFT-for-NFT exchanges with optional exact Object ID matching.
 *
 * Transaction hooks use useDAppKit() for signing.
 * Data-fetching hooks use useCurrentClient() for object queries and
 * JSON-RPC for event queries — the gRPC transport in @mysten/sui v2
 * does not expose a queryEvents API, but every Sui fullnode also
 * serves the JSON-RPC protocol on the same host.
 */

import { useState, useEffect, useCallback } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { useDAppKit, useCurrentClient } from '@mysten/dapp-kit-react';
import {
  PACKAGE_ID,
  CLOCK_ID,
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from '../constants';
import type { ObjectSwapObject, ChainEvent } from '../types';
import { extractTypeParams } from '../utils/parseSwapTypeArgs';

// ── Module constants ────────────────────────────────────────────────

const OBJECT_SWAP_MODULE = `${PACKAGE_ID}::object_swap`;

/**
 * Sui testnet JSON-RPC endpoint.
 * Duplicated from useSwap.ts — shared extraction deferred to avoid
 * modifying existing files in this changeset.
 */
const JSON_RPC_URL = 'https://fullnode.testnet.sui.io:443';

const EVENT_TYPES = {
  created: `${OBJECT_SWAP_MODULE}::ObjectSwapCreated`,
  executed: `${OBJECT_SWAP_MODULE}::ObjectSwapExecuted`,
  cancelled: `${OBJECT_SWAP_MODULE}::ObjectSwapCancelled`,
  destroyed: `${OBJECT_SWAP_MODULE}::ObjectSwapDestroyed`,
} as const;

// ── JSON-RPC event helpers ──────────────────────────────────────────
// Duplicated from useSwap.ts to keep this changeset self-contained.

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

/**
 * Extract an item ID from the JSON representation of `Option<T>`.
 * Handles both string IDs and nested UID structures returned by the RPC.
 */
function parseOptionItem(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const nested = raw as Record<string, unknown>;
    const uid = nested.id;
    if (uid && typeof uid === 'object') {
      return ((uid as Record<string, unknown>).id as string) ?? null;
    }
    if (typeof uid === 'string') return uid;
  }
  return null;
}

/**
 * Extract an object ID from the JSON representation of `Option<ID>`.
 * ID in Sui JSON may appear as a plain hex string or `{ bytes: "0x…" }`.
 */
function parseOptionId(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.bytes === 'string') return obj.bytes;
  }
  return null;
}

/** Map the gRPC object JSON representation into our domain model. */
function parseObjectSwapJson(
  objectId: string,
  objectType: string,
  json: Record<string, unknown> | null,
): ObjectSwapObject | null {
  if (!json) return null;
  const [itemType = '', counterItemType = ''] = extractTypeParams(objectType);

  return {
    id: objectId,
    creator: json.creator as string,
    recipient: json.recipient as string,
    item: parseOptionItem(json.item),
    requested_object_id: parseOptionId(json.requested_object_id),
    description: json.description as string,
    state: Number(json.state),
    created_at: Number(json.created_at),
    timeout_ms: Number(json.timeout_ms),
    item_type: itemType,
    counter_item_type: counterItemType,
  };
}

/**
 * Reconstruct a minimal ObjectSwapObject from the creation event when
 * the on-chain object has already been destroyed.
 */
function objectSwapFromCreationEvent(
  swapId: string,
  ev: RpcEvent,
  state: number,
): ObjectSwapObject {
  const pj = ev.parsedJson;
  return {
    id: swapId,
    creator: pj.creator as string,
    recipient: pj.recipient as string,
    item: null,
    requested_object_id: parseOptionId(pj.requested_object_id),
    description: pj.description as string,
    state,
    created_at: Number(pj.created_at ?? ev.timestampMs),
    timeout_ms: Number(pj.timeout_ms),
    item_type: '',
    counter_item_type: '',
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

interface CreateObjectSwapParams {
  /** Move type tag of T — the creator's deposited asset */
  itemTypeTag: string;
  /** Move type tag of U — the expected counter-asset type */
  counterItemTypeTag: string;
  /** Object ID of the creator's asset to deposit */
  itemObjectId: string;
  recipient: string;
  /** Specific object ID the recipient must provide; omit for "any U" */
  requestedObjectId?: string;
  description: string;
  timeoutMs: number;
}

/**
 * Build & sign an `object_swap::create_object_swap` transaction.
 *
 * TypeArguments: `[T, U]` where T = creator's deposited asset,
 * U = expected counter-asset type (both `key + store`).
 *
 * `requestedObjectId` is BCS-encoded as `Option<ID>` — `Some(address)`
 * when a specific object is required, `None` when any U is acceptable.
 */
export function useCreateObjectSwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: CreateObjectSwapParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${OBJECT_SWAP_MODULE}::create_object_swap`,
          typeArguments: [params.itemTypeTag, params.counterItemTypeTag],
          arguments: [
            tx.object(params.itemObjectId),
            tx.pure.address(params.recipient),
            tx.pure(bcs.option(bcs.Address).serialize(params.requestedObjectId ?? null)),
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

interface ExecuteObjectSwapParams {
  swapObjectId: string;
  /** Move type tag of T — the creator's deposited asset */
  creatorItemType: string;
  /** Move type tag of U — the recipient's counter-asset */
  counterItemType: string;
  /** Object ID of the recipient's U-typed asset to deposit */
  itemBObjectId: string;
}

/**
 * Build & sign an `object_swap::execute_object_swap` transaction.
 *
 * Recipient provides a concrete object of type U, completing
 * the atomic NFT-for-NFT exchange.
 */
export function useExecuteObjectSwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: ExecuteObjectSwapParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${OBJECT_SWAP_MODULE}::execute_object_swap`,
          typeArguments: [params.creatorItemType, params.counterItemType],
          arguments: [tx.object(params.swapObjectId), tx.object(params.itemBObjectId)],
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

interface ObjectSwapIdParams {
  swapObjectId: string;
  /** Move type tag of T */
  creatorItemType: string;
  /** Move type tag of U */
  counterItemType: string;
}

/**
 * Build & sign an `object_swap::cancel_object_swap` transaction.
 * Creator reclaims their asset after timeout. Requires Clock.
 */
export function useCancelObjectSwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: ObjectSwapIdParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${OBJECT_SWAP_MODULE}::cancel_object_swap`,
          typeArguments: [params.creatorItemType, params.counterItemType],
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
 * Build & sign an `object_swap::destroy_object_swap` transaction.
 * Reclaims on-chain storage for a terminated (Executed / Cancelled) swap.
 * Consumes the shared object by value.
 */
export function useDestroyObjectSwap() {
  const dAppKit = useDAppKit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (params: ObjectSwapIdParams) => {
      setLoading(true);
      setError(null);
      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${OBJECT_SWAP_MODULE}::destroy_object_swap`,
          typeArguments: [params.creatorItemType, params.counterItemType],
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
 * Fetch all object swaps where `address` is creator or recipient.
 *
 * Strategy mirrors useMySwaps: event-first discovery with live object
 * enrichment, plus graceful fallback for destroyed objects.
 */
export function useMyObjectSwaps(address: string | undefined) {
  const client = useCurrentClient();
  const [data, setData] = useState<ObjectSwapObject[] | null>(null);
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

      const swaps: ObjectSwapObject[] = [];
      for (let i = 0; i < swapIds.length; i++) {
        const id = swapIds[i];
        const obj = objectsRes.objects[i];

        if (obj instanceof Error) {
          // Object destroyed — reconstruct from creation event
          const ev = mine.find((e) => e.parsedJson.swap_id === id);
          if (ev) {
            swaps.push(
              objectSwapFromCreationEvent(
                id,
                ev,
                inferTerminalState(id, executedIds, cancelledIds),
              ),
            );
          }
          continue;
        }

        const parsed = parseObjectSwapJson(obj.objectId, obj.type, obj.json ?? null);
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
 * Fetch a single ObjectSwap together with all related events for timeline.
 *
 * Falls back to event-driven reconstruction when the object has been
 * destroyed (getObject throws).
 */
export function useObjectSwapDetail(swapId: string | undefined) {
  const client = useCurrentClient();
  const [data, setData] = useState<ObjectSwapObject | null>(null);
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
      let swap: ObjectSwapObject | null = null;
      try {
        const res = await client.getObject({
          objectId: swapId,
          include: { json: true },
        });
        swap = parseObjectSwapJson(res.object.objectId, res.object.type, res.object.json ?? null);
      } catch {
        // Object destroyed — fall back to event reconstruction
        const creationEv = related.find((ev) => ev.type.endsWith('::ObjectSwapCreated'));
        if (creationEv) {
          const hasExecuted = related.some((ev) => ev.type.endsWith('::ObjectSwapExecuted'));
          const hasCancelled = related.some((ev) => ev.type.endsWith('::ObjectSwapCancelled'));
          let state = SWAP_STATE_PENDING;
          if (hasExecuted) state = SWAP_STATE_EXECUTED;
          else if (hasCancelled) state = SWAP_STATE_CANCELLED;

          swap = objectSwapFromCreationEvent(swapId, creationEv, state);
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
