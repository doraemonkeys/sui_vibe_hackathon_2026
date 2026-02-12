import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import type { SwapObject, ObjectSwapObject } from '@/types';
import {
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from '@/constants';
import { useMyObjectSwaps } from '@/hooks/useObjectSwap';
import SwapCard from './SwapCard';
import type { SwapKind } from './SwapCard';

// ── Filter definitions ──

const STATUS_FILTERS: { label: string; value: number | null }[] = [
  { label: 'All', value: null },
  { label: 'Pending', value: SWAP_STATE_PENDING },
  { label: 'Executed', value: SWAP_STATE_EXECUTED },
  { label: 'Cancelled', value: SWAP_STATE_CANCELLED },
];

const KIND_FILTERS: { label: string; value: SwapKind | null }[] = [
  { label: 'All Types', value: null },
  { label: 'Coin Swaps', value: 'coin' },
  { label: 'Object Swaps', value: 'object' },
];

// ── Tagged union for rendering a mixed list with correct kind ──

interface TaggedSwap {
  kind: SwapKind;
  swap: SwapObject | ObjectSwapObject;
  /** Sort key — use created_at for consistent ordering */
  createdAt: number;
}

// ── Animation variants ──

const CARD_VARIANTS = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.3, ease: 'easeOut' as const },
  }),
};

// ── Component ──

interface SwapListProps {
  /** Coin swaps — typically pre-filtered by role from the parent page */
  swaps: SwapObject[];
}

/**
 * Unified swap list — merges Coin Swaps (from props) and Object Swaps
 * (fetched internally) into a single grid with status + kind filters.
 *
 * Object swaps are fetched via useMyObjectSwaps and role-filtered to
 * match the coin swap set passed by the parent (creator vs recipient).
 */
export default function SwapList({ swaps }: SwapListProps) {
  const [statusFilter, setStatusFilter] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<SwapKind | null>(null);

  const account = useCurrentAccount();
  const { data: objectSwaps } = useMyObjectSwaps(account?.address);

  // Infer the active role from coin swaps so we can apply the same
  // filter to object swaps (the parent page role-filters coin swaps).
  const activeRole = useMemo<'creator' | 'recipient' | null>(() => {
    if (!account?.address || swaps.length === 0) return null;
    const first = swaps[0];
    return first.creator === account.address ? 'creator' : 'recipient';
  }, [swaps, account?.address]);

  // Role-filter object swaps to match the parent's tab selection
  const filteredObjectSwaps = useMemo(() => {
    if (!objectSwaps || !account?.address) return [];
    if (activeRole === 'creator') {
      return objectSwaps.filter((s) => s.creator === account.address);
    }
    if (activeRole === 'recipient') {
      return objectSwaps.filter((s) => s.recipient === account.address);
    }
    // No coin swaps to infer from — show all object swaps
    return objectSwaps;
  }, [objectSwaps, account?.address, activeRole]);

  // Merge both swap types into a single tagged list, sorted newest-first
  const merged = useMemo<TaggedSwap[]>(() => {
    const tagged: TaggedSwap[] = [
      ...swaps.map(
        (s): TaggedSwap => ({
          kind: 'coin',
          swap: s,
          createdAt: Number(s.created_at),
        }),
      ),
      ...filteredObjectSwaps.map(
        (s): TaggedSwap => ({
          kind: 'object',
          swap: s,
          createdAt: Number(s.created_at),
        }),
      ),
    ];
    tagged.sort((a, b) => b.createdAt - a.createdAt);
    return tagged;
  }, [swaps, filteredObjectSwaps]);

  // Apply filters
  const filtered = merged.filter((t) => {
    if (statusFilter !== null && t.swap.state !== statusFilter) return false;
    if (kindFilter !== null && t.kind !== kindFilter) return false;
    return true;
  });

  // Empty state — no swaps of either kind
  if (merged.length === 0) {
    return (
      <div className="rounded-2xl border border-subtle bg-surface-soft p-12 text-center">
        <p className="mb-2 text-lg font-semibold text-text-primary">
          No swaps yet
        </p>
        <p className="mb-6 text-sm text-muted">
          Create your first trustless atomic swap on Sui.
        </p>
        <Link
          to="/swap/create"
          className="inline-block rounded-xl gradient-swap px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98]"
        >
          Create Swap
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Filters row */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(({ label, value }) => (
            <button
              key={label}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === value
                  ? 'gradient-swap text-white'
                  : 'bg-surface-soft text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="hidden sm:block h-5 w-px bg-subtle" />

        {/* Kind filter chips */}
        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map(({ label, value }) => (
            <button
              key={label}
              type="button"
              onClick={() => setKindFilter(value)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                kindFilter === value
                  ? 'gradient-swap text-white'
                  : 'bg-surface-soft text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          No swaps match these filters.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tagged, i) => (
            <motion.div
              key={tagged.swap.id}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={CARD_VARIANTS}
            >
              <SwapCard swap={tagged.swap} swapKind={tagged.kind} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
