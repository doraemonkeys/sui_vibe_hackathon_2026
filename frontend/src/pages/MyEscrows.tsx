import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import EscrowList from '@/components/EscrowList';
import { useMyEscrows, useArbiterStats } from '@/hooks/useEscrow';
import type { EscrowObject } from '@/types';

// ── Tab configuration ───────────────────────────────────────────────────────────

type RoleTab = 'creator' | 'recipient' | 'arbiter';

const TABS: { key: RoleTab; label: string }[] = [
  { key: 'creator', label: 'As Creator' },
  { key: 'recipient', label: 'As Recipient' },
  { key: 'arbiter', label: 'As Arbiter' },
];

function filterByRole(escrows: EscrowObject[], role: RoleTab, address: string): EscrowObject[] {
  switch (role) {
    case 'creator':
      return escrows.filter((e) => e.creator === address);
    case 'recipient':
      return escrows.filter((e) => e.recipient === address);
    case 'arbiter':
      return escrows.filter((e) => e.arbiter === address);
  }
}

/** Single stat label + value for the arbiter summary card. */
function StatItem({ label, value, className = '' }: { label: string; value: number; className?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`font-display text-lg font-bold ${className}`}>{value}</span>
      <span className="text-text-secondary">{label}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────────

/** My Escrows page — 3 role-based tabs with count badges, status filter chips inside list. */
export default function MyEscrows() {
  const account = useCurrentAccount();
  const { data, loading, error } = useMyEscrows(account?.address);
  const arbiterStats = useArbiterStats(account?.address);
  const [activeTab, setActiveTab] = useState<RoleTab>('creator');

  const escrows = data ?? [];
  const address = account?.address ?? '';

  // Pre-compute counts for tab badges
  const counts: Record<RoleTab, number> = {
    creator: escrows.filter((e) => e.creator === address).length,
    recipient: escrows.filter((e) => e.recipient === address).length,
    arbiter: escrows.filter((e) => e.arbiter === address).length,
  };

  const filteredEscrows = address
    ? filterByRole(escrows, activeTab, address)
    : [];

  return (
    <motion.main
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="mx-auto max-w-6xl px-4 pt-24 pb-16 sm:px-6"
    >
      {/* ── Header ── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-text-primary">
            My Escrows
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage escrows you participate in.
          </p>
        </div>
        <Link
          to="/create"
          className="gradient-primary inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-shadow"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Escrow
        </Link>
      </div>

      {/* ── Wallet guard ── */}
      {!account && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-subtle bg-surface-soft p-12 text-center">
          <div className="text-4xl">🔒</div>
          <h3 className="text-lg font-semibold text-text-primary">Wallet Required</h3>
          <p className="text-sm text-text-secondary">
            Connect your wallet to view your escrows.
          </p>
        </div>
      )}

      {/* ── Error state ── */}
      {account && error && (
        <div className="rounded-2xl border border-danger/30 bg-rose-50 p-8 text-center">
          <p className="text-sm text-danger">{error.message}</p>
        </div>
      )}

      {/* ── Tabs + List ── */}
      {account && !error && (
        <>
          {/* Role tabs */}
          <div className="mb-6 flex gap-1 rounded-xl border border-subtle bg-surface-soft p-1">
            {TABS.map(({ key, label }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`relative flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                    active
                      ? 'bg-surface text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                  {counts[key] > 0 && (
                    <span
                      className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold ${
                        active
                          ? 'gradient-primary text-white'
                          : 'bg-subtle text-muted'
                      }`}
                    >
                      {counts[key]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Arbiter resolution stats — visible only on the arbiter tab */}
          {activeTab === 'arbiter' && arbiterStats.data && arbiterStats.data.total > 0 && (
            <div className="mb-6 flex items-center gap-6 rounded-xl bg-surface-soft px-5 py-3">
              <StatItem label="Resolutions" value={arbiterStats.data.total} />
              <span className="h-6 w-px bg-subtle" aria-hidden />
              <StatItem label="Released" value={arbiterStats.data.released} className="text-success" />
              <span className="h-6 w-px bg-subtle" aria-hidden />
              <StatItem label="Refunded" value={arbiterStats.data.refunded} className="text-neutral" />
            </div>
          )}

          <EscrowList escrows={filteredEscrows} loading={loading} />
        </>
      )}
    </motion.main>
  );
}
