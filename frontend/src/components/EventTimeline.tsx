import { motion } from 'framer-motion';
import type { ChainEvent } from '@/types';

// ── Helpers ──

/** Truncate a 0x-prefixed address to first 6 + last 4 characters */
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`;
}

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Derive a human-readable label from a fully-qualified Move event type.
 * e.g. "0x…::escrow::EscrowCreated" → "Created"
 */
function eventLabel(type: string): string {
  const segments = type.split('::');
  const raw = segments[segments.length - 1] ?? type;
  return raw.replace(/^(Escrow|Swap|Arbiter)/, '');
}

// ── Animation variants ──

const CONTAINER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const ITEM = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

// ── Component ──

/** Vertical event timeline — reused in EscrowDetail and SwapDetail */
export default function EventTimeline({ events }: { events: ChainEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No events recorded yet.
      </p>
    );
  }

  return (
    <motion.ol
      className="space-y-0"
      initial="hidden"
      animate="visible"
      variants={CONTAINER}
    >
      {events.map((event, i) => (
        <motion.li
          key={`${event.type}-${event.timestamp}-${i}`}
          variants={ITEM}
          className="flex gap-4"
        >
          {/* Dot & vertical connector */}
          <div className="flex flex-col items-center pt-1">
            <span className="h-3 w-3 shrink-0 rounded-full border-2 border-surface bg-info" />
            {i < events.length - 1 && (
              <span className="mt-1 w-0.5 flex-1 rounded-full bg-subtle" />
            )}
          </div>

          {/* Event content */}
          <div className="pb-6">
            <p className="text-sm font-semibold text-text-primary">
              {eventLabel(event.type)}
            </p>
            <p className="font-mono text-xs text-muted">
              {truncateAddress(event.sender)}
            </p>
            <time className="text-xs text-text-secondary">
              {formatTimestamp(event.timestamp)}
            </time>
          </div>
        </motion.li>
      ))}
    </motion.ol>
  );
}
