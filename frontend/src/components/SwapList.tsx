import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { SwapObject } from '@/types';
import {
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from '@/constants';
import SwapCard from './SwapCard';

// ── Filter definitions ──

const STATUS_FILTERS: { label: string; value: number | null }[] = [
  { label: 'All', value: null },
  { label: 'Pending', value: SWAP_STATE_PENDING },
  { label: 'Executed', value: SWAP_STATE_EXECUTED },
  { label: 'Cancelled', value: SWAP_STATE_CANCELLED },
];

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
  swaps: SwapObject[];
}

/** Swap list container — grid of SwapCards with status filter chips */
export default function SwapList({ swaps }: SwapListProps) {
  const [filter, setFilter] = useState<number | null>(null);

  const filtered =
    filter === null ? swaps : swaps.filter((s) => s.state === filter);

  // Empty state with CTA
  if (swaps.length === 0) {
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
      {/* Status filter chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map(({ label, value }) => (
          <button
            key={label}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              filter === value
                ? 'gradient-swap text-white'
                : 'bg-surface-soft text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          No swaps match this filter.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((swap, i) => (
            <motion.div
              key={swap.id}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={CARD_VARIANTS}
            >
              <SwapCard swap={swap} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
