import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import EscrowCard from '@/components/EscrowCard';
import {
  ESCROW_STATE_ACTIVE,
  ESCROW_STATE_DISPUTED,
  ESCROW_STATE_RELEASED,
  ESCROW_STATE_REFUNDED,
} from '@/constants';
import type { EscrowObject } from '@/types';

// ── Filter chip configuration ───────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: null as number | null, label: 'All' },
  { value: ESCROW_STATE_ACTIVE, label: 'Active' },
  { value: ESCROW_STATE_DISPUTED, label: 'Disputed' },
  { value: ESCROW_STATE_RELEASED, label: 'Released' },
  { value: ESCROW_STATE_REFUNDED, label: 'Refunded' },
] as const;

// ── Grid stagger animation ──────────────────────────────────────────────────────

const GRID_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

// ── Component ───────────────────────────────────────────────────────────────────

interface EscrowListProps {
  escrows: EscrowObject[];
  loading: boolean;
}

/** Grid of EscrowCards with status filter chips. Shows empty-state CTA when empty. */
export default function EscrowList({ escrows, loading }: EscrowListProps) {
  const [statusFilter, setStatusFilter] = useState<number | null>(null);

  const filtered =
    statusFilter === null
      ? escrows
      : escrows.filter((e) => e.state === statusFilter);

  return (
    <div>
      {/* ── Status filter chips ── */}
      <div className="mb-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map(({ value, label }) => {
          const active = statusFilter === value;
          const count =
            value === null
              ? escrows.length
              : escrows.filter((e) => e.state === value).length;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                active
                  ? 'gradient-primary text-white shadow-sm'
                  : 'border border-subtle bg-surface text-text-secondary hover:bg-surface-soft'
              }`}
            >
              {label}
              {count > 0 && (
                <span
                  className={`ml-1.5 ${active ? 'text-white/80' : 'text-muted'}`}
                >
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Loading state ── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <span className="h-8 w-8 animate-spin rounded-full border-3 border-subtle border-t-info" />
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-subtle bg-surface-soft p-12 text-center"
        >
          <div className="text-4xl">📦</div>
          <h3 className="text-lg font-semibold text-text-primary">
            {statusFilter !== null ? 'No matching escrows' : 'No escrows yet'}
          </h3>
          <p className="max-w-sm text-sm text-text-secondary">
            {statusFilter !== null
              ? 'Try a different filter or create a new escrow.'
              : 'Create your first escrow to get started with trustless deals on Sui.'}
          </p>
          <Link
            to="/create"
            className="gradient-primary mt-2 inline-block rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-shadow"
          >
            Create Escrow
          </Link>
        </motion.div>
      )}

      {/* ── Card grid ── */}
      {!loading && filtered.length > 0 && (
        <motion.div
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          variants={GRID_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          {filtered.map((escrow) => (
            <EscrowCard key={escrow.id} escrow={escrow} />
          ))}
        </motion.div>
      )}
    </div>
  );
}
