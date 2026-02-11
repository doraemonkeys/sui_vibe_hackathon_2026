import {
  ESCROW_STATE_ACTIVE,
  ESCROW_STATE_DISPUTED,
  ESCROW_STATE_RELEASED,
  ESCROW_STATE_REFUNDED,
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from '@/constants';

interface StatusConfig {
  label: string;
  /** Tailwind classes for the colored dot */
  dotClass: string;
  /** Tailwind classes for the pill background + text color */
  pillClass: string;
  /** Whether the dot should animate (Active / Disputed / Pending) */
  pulse: boolean;
}

// ── Escrow status table (plan §Status Badge) ──

const ESCROW_MAP: Record<number, StatusConfig> = {
  [ESCROW_STATE_ACTIVE]: {
    label: 'Active',
    dotClass: 'bg-amber-500',
    pillClass: 'bg-amber-100 text-amber-800',
    pulse: true,
  },
  [ESCROW_STATE_DISPUTED]: {
    label: 'Disputed',
    dotClass: 'bg-rose-500',
    pillClass: 'bg-rose-100 text-rose-800',
    pulse: true,
  },
  [ESCROW_STATE_RELEASED]: {
    label: 'Released',
    dotClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-100 text-emerald-800',
    pulse: false,
  },
  [ESCROW_STATE_REFUNDED]: {
    label: 'Refunded',
    dotClass: 'bg-slate-400',
    pillClass: 'bg-slate-100 text-slate-700',
    pulse: false,
  },
};

// ── Swap status table ──

const SWAP_MAP: Record<number, StatusConfig> = {
  [SWAP_STATE_PENDING]: {
    label: 'Pending',
    dotClass: 'bg-indigo-500',
    pillClass: 'bg-indigo-100 text-indigo-800',
    pulse: true,
  },
  [SWAP_STATE_EXECUTED]: {
    label: 'Executed',
    dotClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-100 text-emerald-800',
    pulse: false,
  },
  [SWAP_STATE_CANCELLED]: {
    label: 'Cancelled',
    dotClass: 'bg-slate-400',
    pillClass: 'bg-slate-100 text-slate-700',
    pulse: false,
  },
};

const FALLBACK: StatusConfig = {
  label: 'Unknown',
  dotClass: 'bg-gray-400',
  pillClass: 'bg-gray-100 text-gray-600',
  pulse: false,
};

interface StatusBadgeProps {
  status: number;
  module: 'escrow' | 'swap';
}

/** Semantic-colored status badge — supports both Escrow and Swap state sets */
export default function StatusBadge({ status, module }: StatusBadgeProps) {
  const map = module === 'escrow' ? ESCROW_MAP : SWAP_MAP;
  const cfg = map[status] ?? FALLBACK;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cfg.pillClass}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${cfg.dotClass} ${cfg.pulse ? 'animate-status-pulse' : ''}`}
      />
      {cfg.label}
    </span>
  );
}
