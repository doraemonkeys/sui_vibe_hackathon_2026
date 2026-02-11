import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import StatusBadge from '@/components/StatusBadge';
import type { EscrowObject } from '@/types';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`;
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}\u2026${id.slice(-4)}`;
}

/** Extract a readable asset label from a full Move type tag. */
function formatAssetType(type: string): string {
  if (type.includes('sui::SUI')) return 'SUI Coin';
  const parts = type.split('::');
  return parts.length >= 2
    ? `${parts[parts.length - 2]}::${parts[parts.length - 1]}`
    : type;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Animation ───────────────────────────────────────────────────────────────────

/** Used by parent grid for staggered card entrance. */
const CARD_VARIANTS = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

// ── Component ───────────────────────────────────────────────────────────────────

interface EscrowCardProps {
  escrow: EscrowObject;
}

/**
 * Compact escrow summary card for list views.
 * Top 3px gradient band (orange→coral), hover lift, click navigates to detail.
 */
export default function EscrowCard({ escrow }: EscrowCardProps) {
  const navigate = useNavigate();

  return (
    <motion.article
      variants={CARD_VARIANTS}
      whileHover={{ y: -2, boxShadow: '0 10px 25px -5px rgba(0,0,0,.08)' }}
      onClick={() => navigate(`/escrow/${escrow.id}`)}
      className="relative cursor-pointer overflow-hidden rounded-2xl border border-subtle bg-surface transition-colors"
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/escrow/${escrow.id}`)}
    >
      {/* Gradient top band */}
      <div className="h-[3px] gradient-escrow" />

      <div className="p-5 sm:p-6">
        {/* Header: ID + Status */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted" title={escrow.id}>
            {truncateId(escrow.id)}
          </span>
          <StatusBadge status={escrow.state} module="escrow" />
        </div>

        {/* Asset type indicator */}
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-sm">
            💰
          </span>
          <span className="text-sm font-semibold text-text-primary">
            {formatAssetType(escrow.item_type)}
          </span>
        </div>

        {/* Description excerpt */}
        {escrow.description && (
          <p className="mb-4 line-clamp-2 text-sm text-text-secondary">
            {escrow.description}
          </p>
        )}

        {/* Addresses */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-muted">Creator</span>
            <span className="font-mono text-text-secondary" title={escrow.creator}>
              {truncateAddress(escrow.creator)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-muted">Recipient</span>
            <span className="font-mono text-text-secondary" title={escrow.recipient}>
              {truncateAddress(escrow.recipient)}
            </span>
          </div>
        </div>

        {/* Footer: date */}
        <div className="mt-4 border-t border-subtle pt-3">
          <time className="text-xs text-muted">{formatDate(escrow.created_at)}</time>
        </div>
      </div>
    </motion.article>
  );
}
