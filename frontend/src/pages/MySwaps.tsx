import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { useMySwaps } from '@/hooks/useSwap';
import SwapList from '@/components/SwapList';

// ── Tab definitions ──

type RoleTab = 'creator' | 'recipient';

const TABS: { key: RoleTab; label: string }[] = [
  { key: 'creator', label: 'As Creator' },
  { key: 'recipient', label: 'As Recipient' },
];

// ── Component ──

/** My Swaps page — 2-tab listing filtered by wallet role, with count badges */
export default function MySwaps() {
  const account = useCurrentAccount();
  const { data: swaps, loading, error, refetch } = useMySwaps(
    account?.address,
  );
  const [tab, setTab] = useState<RoleTab>('creator');

  // Split swaps by role
  const creatorSwaps =
    swaps?.filter((s) => s.creator === account?.address) ?? [];
  const recipientSwaps =
    swaps?.filter((s) => s.recipient === account?.address) ?? [];
  const activeSwaps = tab === 'creator' ? creatorSwaps : recipientSwaps;

  function renderSwapContent() {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-24">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-info border-t-transparent" />
        </div>
      );
    }
    if (error) {
      return (
        <div className="rounded-2xl border border-danger/30 bg-rose-50 p-8 text-center">
          <p className="font-semibold text-danger">
            Failed to load swaps
          </p>
          <p className="mt-1 text-sm text-danger/80">{error.message}</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-4 rounded-xl border border-subtle px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
    return <SwapList swaps={activeSwaps} />;
  }

  return (
    <motion.main
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="mx-auto max-w-6xl px-4 pt-24 pb-16 sm:px-6"
    >
      {/* ── Page header ── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-3xl font-bold gradient-text sm:text-4xl">
          My Swaps
        </h1>
        <Link
          to="/swap/create"
          className="inline-block self-start rounded-xl gradient-swap px-5 py-2.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98]"
        >
          + New Swap
        </Link>
      </div>

      {/* ── Wallet guard ── */}
      {!account ? (
        <div className="rounded-2xl border border-subtle bg-surface-soft p-12 text-center">
          <p className="text-lg font-semibold text-text-primary">
            Connect your wallet
          </p>
          <p className="mt-1 text-sm text-muted">
            Connect a wallet to view your swaps.
          </p>
        </div>
      ) : (
        <>
          {/* ── Tabs ── */}
          <div className="mb-6 flex gap-1 rounded-xl bg-surface-soft p-1">
            {TABS.map(({ key, label }) => {
              const count =
                key === 'creator'
                  ? creatorSwaps.length
                  : recipientSwaps.length;
              const isActive = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`relative flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-surface text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                  {/* Count badge */}
                  {swaps && (
                    <span
                      className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                        isActive
                          ? 'gradient-swap text-white'
                          : 'bg-subtle/50 text-muted'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Content ── */}
          {renderSwapContent()}
        </>
      )}
    </motion.main>
  );
}
