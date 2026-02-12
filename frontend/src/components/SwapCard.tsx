import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { SwapObject, ObjectSwapObject } from '@/types';
import StatusBadge from './StatusBadge';

// ── Helpers ──

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

/** Matches bare SUI coin type tag (without Coin<> wrapper). */
const SUI_TYPE_RE = /^0x0*2::sui::SUI$/;

/** Extract a display-friendly short name from a fully-qualified Move type. */
function shortType(type: string): string {
  if (!type) return 'Unknown';
  if (SUI_TYPE_RE.test(type)) return 'SUI';
  const open = type.indexOf('<');
  const base = open === -1 ? type : type.slice(0, open);
  const parts = base.split('::');
  return parts[parts.length - 1] ?? type;
}

const MIST_PER_SUI = 1_000_000_000n;

/** Convert MIST string to human-readable SUI amount. */
function formatSuiAmount(mistStr: string): string {
  const mist = BigInt(mistStr || '0');
  const whole = mist / MIST_PER_SUI;
  const frac = mist % MIST_PER_SUI;
  if (frac === 0n) return whole.toString();
  // Show up to 4 decimal places, trimming trailing zeros
  const fracStr = frac.toString().padStart(9, '0').slice(0, 4).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

// ── Gradient styles ──

/** Teal-to-emerald gradient for Object Swap cards (distinct from mint Coin gradient). */
const OBJECT_SWAP_GRADIENT: React.CSSProperties = {
  background: 'linear-gradient(135deg, #0d9488, #14b8a6, #2dd4bf)',
};

// ── Component ──

export type SwapKind = 'coin' | 'object';

interface SwapCardProps {
  swap: SwapObject | ObjectSwapObject;
  swapKind: SwapKind;
}

/** Swap list card — gradient top-border accent, dual-asset preview */
export default function SwapCard({ swap, swapKind }: SwapCardProps) {
  const navigate = useNavigate();
  const isCoin = swapKind === 'coin';

  // ── Right-side display (what the creator wants in return) ──
  let rightLabel: string;
  let rightSublabel: string;
  if (isCoin) {
    const coinSwap = swap as SwapObject;
    const coinName = shortType(coinSwap.coin_type);
    const amount = formatSuiAmount(coinSwap.requested_amount);
    rightLabel = `\u2265 ${amount} ${coinName}`;
    rightSublabel = 'Price';
  } else {
    const objSwap = swap as ObjectSwapObject;
    const typeName = shortType(objSwap.counter_item_type);
    rightLabel = objSwap.requested_object_id
      ? `\u21c4 ${typeName}`
      : `\u21c4 ${typeName} (any)`;
    rightSublabel = 'Wanted';
  }

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() =>
        navigate(`/swap/${swap.id}`, { state: { kind: swapKind } })
      }
      className="cursor-pointer rounded-2xl border border-subtle bg-surface overflow-hidden transition-shadow hover:shadow-lg"
    >
      {/* Top gradient band — mint for Coin, teal for Object */}
      {isCoin ? (
        <div className="h-[3px] gradient-swap" />
      ) : (
        <div className="h-[3px]" style={OBJECT_SWAP_GRADIENT} />
      )}

      <div className="p-5 sm:p-6">
        {/* Header: ID + Kind badge + Status */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs text-muted truncate">
              {truncateAddress(swap.id)}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${
                isCoin ? 'gradient-swap' : ''
              }`}
              style={isCoin ? undefined : OBJECT_SWAP_GRADIENT}
            >
              {isCoin ? 'Coin' : 'Object'}
            </span>
          </div>
          <StatusBadge status={swap.state} module="swap" />
        </div>

        {/* Dual asset preview with directional arrow */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded-xl bg-surface-soft p-3 text-center">
            <p className="truncate text-sm font-semibold text-text-primary">
              {shortType(swap.item_type)}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
              Deposit
            </p>
          </div>
          <span className="shrink-0 text-lg text-muted">
            {isCoin ? '\u2192' : '\u21c4'}
          </span>
          <div className="flex-1 min-w-0 rounded-xl bg-surface-soft p-3 text-center">
            <p className="truncate text-sm font-semibold text-text-primary">
              {rightLabel}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
              {rightSublabel}
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
