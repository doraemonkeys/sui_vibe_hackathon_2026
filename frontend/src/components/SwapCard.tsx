import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { SwapObject } from '@/types';
import StatusBadge from './StatusBadge';

// ── Helpers ──

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

/** Matches SUI Coin type regardless of address zero-padding (0x2 vs 0x000…002). */
const SUI_COIN_RE = /::coin::Coin<0x0*2::sui::SUI>/;

/** Extract a display-friendly short name from a fully-qualified Move type. */
function shortType(type: string): string {
  if (!type) return 'Unknown';
  if (SUI_COIN_RE.test(type)) return 'SUI';
  const open = type.indexOf('<');
  const base = open === -1 ? type : type.slice(0, open);
  const parts = base.split('::');
  return parts[parts.length - 1] ?? type;
}

// ── Component ──

interface SwapCardProps {
  swap: SwapObject;
}

/** Swap list card — cool gradient top-border accent, dual-asset preview */
export default function SwapCard({ swap }: SwapCardProps) {
  const navigate = useNavigate();

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate(`/swap/${swap.id}`)}
      className="cursor-pointer rounded-2xl border border-subtle bg-surface overflow-hidden transition-shadow hover:shadow-lg"
    >
      {/* Top gradient band (mint → sky blue) */}
      <div className="h-[3px] gradient-swap" />

      <div className="p-5 sm:p-6">
        {/* Header: ID + Status */}
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-xs text-muted">
            {truncateAddress(swap.id)}
          </span>
          <StatusBadge status={swap.state} module="swap" />
        </div>

        {/* Dual asset preview with directional arrow */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded-xl bg-surface-soft p-3 text-center">
            <p className="truncate text-sm font-semibold text-text-primary">
              {shortType(swap.item_a_type)}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
              Deposit
            </p>
          </div>
          <span className="shrink-0 text-lg text-muted">{'\u2192'}</span>
          <div className="flex-1 min-w-0 rounded-xl bg-surface-soft p-3 text-center">
            <p className="truncate text-sm font-semibold text-text-primary">
              {shortType(swap.item_b_type)}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
              Expected
            </p>
          </div>
        </div>

        {/* Description (if present) */}
        {swap.description && (
          <p className="mb-3 truncate text-sm text-text-secondary">
            {swap.description}
          </p>
        )}

        {/* Creator / Recipient addresses */}
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            <span className="text-text-secondary">Creator</span>{' '}
            <span className="font-mono">{truncateAddress(swap.creator)}</span>
          </span>
          <span>
            <span className="text-text-secondary">Recipient</span>{' '}
            <span className="font-mono">{truncateAddress(swap.recipient)}</span>
          </span>
        </div>
      </div>
    </motion.div>
  );
}
