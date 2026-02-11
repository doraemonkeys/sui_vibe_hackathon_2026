import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import {
  useSwapDetail,
  useExecuteSwap,
  useCancelSwap,
  useDestroySwap,
} from '@/hooks/useSwap';
import {
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from '@/constants';
import StatusBadge from './StatusBadge';
import EventTimeline from './EventTimeline';
import TransactionToast from './TransactionToast';
import { ConfettiEffect, ParticleEffect, AnimatedNumber } from '@/components/effects';

// ── Helpers ──

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function shortType(type: string): string {
  if (!type) return 'Unknown';
  if (type.includes('Coin<0x2::sui::SUI>')) return 'SUI Coin';
  const open = type.indexOf('<');
  const base = open === -1 ? type : type.slice(0, open);
  const parts = base.split('::');
  return parts.slice(-2).join('::');
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Expired';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function suiToMist(sui: number): bigint {
  return BigInt(Math.round(sui * 1_000_000_000));
}

const isSuiCoin = (type: string) => type.includes('Coin<0x2::sui::SUI>');

// ── Hooks ──

/** Tracks swap state transitions and triggers celebration effects on execution. */
function useCelebration(swapState: number | undefined) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [showParticles, setShowParticles] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const prevStateRef = useRef<number | null>(null);

  useEffect(() => {
    if (swapState === undefined) return;
    const shouldCelebrate = prevStateRef.current !== null
      && prevStateRef.current !== swapState
      && swapState === SWAP_STATE_EXECUTED;
    prevStateRef.current = swapState;
    if (!shouldCelebrate) return;
    // Defer setState to avoid synchronous call in effect body
    const t = setTimeout(() => {
      setShowConfetti(true);
      setShowParticles(true);
      setShowHighlight(true);
    }, 0);
    return () => clearTimeout(t);
  }, [swapState]);

  useEffect(() => {
    if (showHighlight) {
      const timer = setTimeout(() => setShowHighlight(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [showHighlight]);

  return { showConfetti, setShowConfetti, showParticles, setShowParticles, showHighlight };
}

// ── Component ──

interface SwapDetailProps {
  swapId: string;
}

/**
 * Swap detail view — dual-column asset comparison, role-based actions,
 * timeout countdown, and event timeline.
 * Falls back to event-driven rendering when the object has been destroyed.
 */
export default function SwapDetail({ swapId }: SwapDetailProps) {
  const account = useCurrentAccount();
  const { data: swap, events, loading, error, refetch } =
    useSwapDetail(swapId);

  // Action hooks
  const executeSwap = useExecuteSwap();
  const cancelSwap = useCancelSwap();
  const destroySwap = useDestroySwap();

  // Countdown timer — ticks every second while the swap is pending
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const raf = requestAnimationFrame(update);
    const timer = setInterval(update, 1_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, []);

  // Local action UI state
  type SwapAction = 'execute' | 'cancel' | 'destroy' | null;
  const [activeAction, setActiveAction] = useState<SwapAction>(null);
  const [executeSuiAmount, setExecuteSuiAmount] = useState('');
  const [executeAssetId, setExecuteAssetId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Celebration effects triggered on state transition to Executed
  const { showConfetti, setShowConfetti, showParticles, setShowParticles, showHighlight } =
    useCelebration(swap?.state);
  const [showToast, setShowToast] = useState(false);
  const handleToastDone = useCallback(() => setShowToast(false), []);

  // ── Loading / error states ──

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
        <p className="font-semibold text-danger">Failed to load swap</p>
        <p className="mt-1 text-sm text-danger/80">{error.message}</p>
      </div>
    );
  }

  if (!swap) {
    return (
      <div className="rounded-2xl border border-subtle bg-surface-soft p-12 text-center">
        <p className="text-lg font-semibold text-text-primary">
          Swap not found
        </p>
        <p className="mt-1 text-sm text-muted">
          This swap may have been destroyed or does not exist.
        </p>
      </div>
    );
  }

  // ── Derived state ──

  const isDestroyed = events.some((e) => e.type.endsWith('::SwapDestroyed'));
  const isCreator = account?.address === swap.creator;
  const isRecipient = account?.address === swap.recipient;
  const isPending = swap.state === SWAP_STATE_PENDING;
  const isExecuted = swap.state === SWAP_STATE_EXECUTED;
  const isCancelled = swap.state === SWAP_STATE_CANCELLED;

  const deadline = swap.created_at + swap.timeout_ms;
  const remaining = Math.max(0, deadline - now);
  const isTimedOut = remaining <= 0;

  // Role-based action visibility
  const canExecute = isRecipient && isPending && !isDestroyed;
  const canCancel = isCreator && isPending && isTimedOut && !isDestroyed;
  const canDestroy = (isExecuted || isCancelled) && !isDestroyed;
  const hasAnyAction = canExecute || canCancel || canDestroy;

  // On Executed: swap card positions for the "assets exchanged" visual
  const isSwapped = isExecuted;

  // Timeout in hours for animated display
  const timeoutHours = swap.timeout_ms / 3_600_000;
  const timeoutDecimals = swap.timeout_ms % 3_600_000 === 0 ? 0 : 1;

  // ── Action handlers ──

  const clearAction = () => {
    setActiveAction(null);
    setActionError(null);
    setExecuteSuiAmount('');
    setExecuteAssetId('');
  };

  const runAction = async (action: () => Promise<unknown>, successMsg: string) => {
    setActionError(null);
    setShowToast(true);
    try {
      await action();
      clearAction();
      setSuccessMessage(successMsg);
      setTimeout(() => setSuccessMessage(null), 5_000);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const swapArgs = { swapObjectId: swap.id, creatorAssetType: swap.item_a_type, recipientAssetType: swap.item_b_type };

  const handleExecute = () => runAction(
    () => executeSwap.execute({
      ...swapArgs,
      ...(isSuiCoin(swap.item_b_type)
        ? { suiCoinAmountMist: suiToMist(parseFloat(executeSuiAmount)) }
        : { assetObjectId: executeAssetId }),
    }),
    'Swap executed successfully!',
  );

  const handleCancel = () => runAction(
    () => cancelSwap.execute(swapArgs),
    'Swap cancelled. Asset returned to creator.',
  );

  const handleDestroy = () => runAction(
    () => destroySwap.execute(swapArgs),
    'Swap destroyed. On-chain storage reclaimed.',
  );

  const anyActionLoading = executeSwap.loading || cancelSwap.loading || destroySwap.loading;

  // ── Render ──

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-8"
    >
      <SwapHeader swapId={swapId} state={swap.state} isDestroyed={isDestroyed} description={swap.description} />

      {/* ── Dual-column asset comparison ── */}
      <SwapAssetComparison
        swap={swap}
        isSwapped={isSwapped}
        isCreator={isCreator}
        isRecipient={isRecipient}
        showHighlight={showHighlight}
        showParticles={showParticles}
        onParticlesDone={() => setShowParticles(false)}
      />

      {/* ── Timeout countdown ── */}
      {isPending && !isDestroyed && (
        <div className="rounded-xl border border-subtle bg-surface-soft p-4 text-center">
          <span className="text-sm text-text-secondary">Timeout: </span>
          <span
            className={`font-display text-sm font-bold ${
              isTimedOut ? 'text-danger' : 'text-text-primary'
            }`}
          >
            {isTimedOut ? 'Expired' : `${formatCountdown(remaining)} remaining`}
          </span>
          <p className="mt-1 text-xs text-muted">
            Total: <span className="font-display font-semibold"><AnimatedNumber value={timeoutHours} decimals={timeoutDecimals} /></span> hours
          </p>
          {isTimedOut && isCreator && (
            <p className="mt-1 text-xs text-muted">
              You can now cancel this swap and reclaim your asset.
            </p>
          )}
        </div>
      )}

      {/* ── Success banner ── */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-success/30 bg-emerald-50 p-4 text-center text-sm font-semibold text-success"
          >
            {successMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Role-based action buttons ── */}
      {hasAnyAction && (
        <SwapActionPanel
          canExecute={canExecute}
          canCancel={canCancel}
          canDestroy={canDestroy}
          activeAction={activeAction}
          setActiveAction={setActiveAction}
          anyActionLoading={anyActionLoading}
          itemBType={swap.item_b_type}
          executeSuiAmount={executeSuiAmount}
          setExecuteSuiAmount={setExecuteSuiAmount}
          executeAssetId={executeAssetId}
          setExecuteAssetId={setExecuteAssetId}
          actionError={actionError}
          executeLoading={executeSwap.loading}
          cancelLoading={cancelSwap.loading}
          destroyLoading={destroySwap.loading}
          onExecute={handleExecute}
          onCancel={handleCancel}
          onDestroy={handleDestroy}
          onClearAction={clearAction}
        />
      )}

      {/* ── Event Timeline ── */}
      <div className="rounded-2xl border border-subtle bg-surface p-6">
        <h3 className="mb-4 font-display text-lg font-semibold">
          Event Timeline
        </h3>
        <EventTimeline events={events} />
      </div>

      {/* Celebration effects */}
      {showConfetti && (
        <ConfettiEffect onComplete={() => setShowConfetti(false)} />
      )}
      <TransactionToast visible={showToast} onDone={handleToastDone} />
    </motion.div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── Local sub-components ─────────────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Swap title with truncated ID, status badge, and optional description. */
function SwapHeader({ swapId, state, isDestroyed, description }: {
  swapId: string;
  state: number;
  isDestroyed: boolean;
  description?: string;
}) {
  return (
    <>
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold sm:text-3xl">
          Swap{' '}
          <span className="font-mono text-base text-muted sm:text-lg">
            {truncateAddress(swapId)}
          </span>
        </h2>
        <div className="mt-3 flex items-center justify-center gap-2">
          <StatusBadge status={state} module="swap" />
          {isDestroyed && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              Destroyed
            </span>
          )}
        </div>
      </div>

      {description && (
        <p className="text-center text-sm text-text-secondary">
          {description}
        </p>
      )}
    </>
  );
}

/** Dual-column asset comparison with animated layout swap on execution. */
function SwapAssetComparison({
  swap,
  isSwapped,
  isCreator,
  isRecipient,
  showHighlight,
  showParticles,
  onParticlesDone,
}: {
  swap: { item_a_type: string; item_b_type: string; creator: string; recipient: string; state: number };
  isSwapped: boolean;
  isCreator: boolean;
  isRecipient: boolean;
  showHighlight: boolean;
  showParticles: boolean;
  onParticlesDone: () => void;
}) {
  const accentClass = isSwapped ? 'border-emerald-200' : undefined;

  return (
    <div className={`rounded-2xl border bg-surface p-6 sm:p-8 transition-all duration-500 ${showHighlight ? 'border-success ring-2 ring-success/30 shadow-lg shadow-success/10' : 'border-subtle'}`}>
      <LayoutGroup>
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-8">
          {isSwapped ? (
            <>
              <motion.div layout layoutId="recipient-asset" className="w-full flex-1 md:w-auto">
                <AssetCard
                  title="Recipient\u2019s Counter-Asset"
                  type={swap.item_b_type}
                  address={swap.recipient}
                  highlight={isRecipient}
                  accentClass={accentClass}
                />
              </motion.div>

              <div className="relative">
                <SwapArrow state={swap.state} />
                {showParticles && <ParticleEffect onComplete={onParticlesDone} />}
              </div>

              <motion.div layout layoutId="creator-asset" className="w-full flex-1 md:w-auto">
                <AssetCard
                  title="Creator\u2019s Deposit"
                  type={swap.item_a_type}
                  address={swap.creator}
                  highlight={isCreator}
                  accentClass={accentClass}
                />
              </motion.div>
            </>
          ) : (
            <>
              <motion.div layout layoutId="creator-asset" className="w-full flex-1 md:w-auto">
                <AssetCard
                  title="Creator\u2019s Deposit"
                  type={swap.item_a_type}
                  address={swap.creator}
                  highlight={isCreator}
                />
              </motion.div>

              <div className="relative">
                <SwapArrow state={swap.state} />
                {showParticles && <ParticleEffect onComplete={onParticlesDone} />}
              </div>

              <motion.div layout layoutId="recipient-asset" className="w-full flex-1 md:w-auto">
                <AssetCard
                  title="Expected from Recipient"
                  type={swap.item_b_type}
                  address={swap.recipient}
                  highlight={isRecipient}
                />
              </motion.div>
            </>
          )}
        </div>
      </LayoutGroup>
    </div>
  );
}

/** Action buttons and expanded confirmation forms for execute/cancel/destroy. */
function SwapActionPanel({
  canExecute,
  canCancel,
  canDestroy,
  activeAction,
  setActiveAction,
  anyActionLoading,
  itemBType,
  executeSuiAmount,
  setExecuteSuiAmount,
  executeAssetId,
  setExecuteAssetId,
  actionError,
  executeLoading,
  cancelLoading,
  destroyLoading,
  onExecute,
  onCancel,
  onDestroy,
  onClearAction,
}: {
  canExecute: boolean;
  canCancel: boolean;
  canDestroy: boolean;
  activeAction: 'execute' | 'cancel' | 'destroy' | null;
  setActiveAction: (a: 'execute' | 'cancel' | 'destroy' | null) => void;
  anyActionLoading: boolean;
  itemBType: string;
  executeSuiAmount: string;
  setExecuteSuiAmount: (v: string) => void;
  executeAssetId: string;
  setExecuteAssetId: (v: string) => void;
  actionError: string | null;
  executeLoading: boolean;
  cancelLoading: boolean;
  destroyLoading: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onDestroy: () => void;
  onClearAction: () => void;
}) {
  return (
    <div className="rounded-2xl border border-subtle bg-surface p-6">
      <h3 className="mb-4 font-display text-lg font-semibold">Actions</h3>

      <div className="flex flex-wrap gap-3">
        {canExecute && (
          <button
            type="button"
            onClick={() => setActiveAction(activeAction === 'execute' ? null : 'execute')}
            disabled={anyActionLoading}
            className="rounded-xl gradient-swap px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Execute Swap
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={() => setActiveAction(activeAction === 'cancel' ? null : 'cancel')}
            disabled={anyActionLoading}
            className="rounded-xl border border-danger/30 bg-rose-50 px-6 py-3 font-semibold text-danger transition hover:bg-rose-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Cancel Swap
          </button>
        )}

        {canDestroy && (
          <button
            type="button"
            onClick={() => setActiveAction(activeAction === 'destroy' ? null : 'destroy')}
            disabled={anyActionLoading}
            className="rounded-xl border border-subtle px-6 py-3 font-semibold text-text-secondary transition hover:bg-surface-soft active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Destroy (Reclaim Storage)
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {activeAction === 'execute' && (
          <motion.div
            key="execute-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-xl border border-info/20 bg-indigo-50 p-5 space-y-4">
              <p className="text-sm font-medium text-text-primary">
                Provide your counter-asset to complete the swap:
              </p>

              {isSuiCoin(itemBType) ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                    Amount (SUI)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    placeholder="e.g. 10.5"
                    value={executeSuiAmount}
                    onChange={(e) => setExecuteSuiAmount(e.target.value)}
                    className="w-full rounded-xl border border-subtle bg-white px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-info/30 transition"
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                    Your Asset Object ID
                  </label>
                  <input
                    type="text"
                    placeholder="0x\u2026"
                    value={executeAssetId}
                    onChange={(e) => setExecuteAssetId(e.target.value)}
                    className="w-full rounded-xl border border-subtle bg-white px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-info/30 transition"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Expected type:{' '}
                    <span className="font-mono">{shortType(itemBType)}</span>
                  </p>
                </div>
              )}

              {actionError && (
                <p className="text-sm text-danger">{actionError}</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onExecute}
                  disabled={
                    executeLoading ||
                    (isSuiCoin(itemBType)
                      ? !executeSuiAmount || parseFloat(executeSuiAmount) <= 0
                      : !executeAssetId)
                  }
                  className="rounded-xl gradient-swap px-6 py-2.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {executeLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Processing\u2026
                    </span>
                  ) : (
                    'Confirm Execute'
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClearAction}
                  disabled={executeLoading}
                  className="rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {activeAction === 'cancel' && (
          <motion.div
            key="cancel-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-xl border border-danger/20 bg-rose-50 p-5 space-y-4">
              <p className="text-sm text-text-primary">
                Cancelling will return the deposited asset to the creator.
                This action cannot be undone.
              </p>

              {actionError && (
                <p className="text-sm text-danger">{actionError}</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={cancelLoading}
                  className="rounded-xl bg-danger px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-danger/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {cancelLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Processing\u2026
                    </span>
                  ) : (
                    'Confirm Cancel'
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClearAction}
                  disabled={cancelLoading}
                  className="rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
                >
                  Go Back
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {activeAction === 'destroy' && (
          <motion.div
            key="destroy-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-xl border border-subtle bg-surface-soft p-5 space-y-4">
              <p className="text-sm text-text-primary">
                Destroying reclaims on-chain storage. The swap object will be
                permanently deleted, but all events remain on-chain.
              </p>

              {actionError && (
                <p className="text-sm text-danger">{actionError}</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onDestroy}
                  disabled={destroyLoading}
                  className="rounded-xl border border-subtle bg-neutral px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {destroyLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Processing\u2026
                    </span>
                  ) : (
                    'Confirm Destroy'
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClearAction}
                  disabled={destroyLoading}
                  className="rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
                >
                  Go Back
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Single asset card in the dual-column comparison layout. */
function AssetCard({
  title,
  type,
  address,
  highlight,
  accentClass,
}: {
  title: string;
  type: string;
  address: string;
  /** True when the connected wallet matches this side's address */
  highlight: boolean;
  accentClass?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-5 text-center transition-colors ${
        accentClass ?? 'border-subtle'
      } ${highlight ? 'bg-indigo-50/60 ring-1 ring-indigo-200' : 'bg-surface-soft'}`}
    >
      <p className="font-display text-sm font-bold text-text-primary">
        {shortType(type)}
      </p>
      <p className="mt-2.5 font-mono text-xs text-muted">
        {truncateAddress(address)}
        {highlight && (
          <span className="ml-1 font-sans font-semibold text-info">(You)</span>
        )}
      </p>
      <p className="mt-1.5 text-xs text-text-secondary">{title}</p>
    </div>
  );
}

/**
 * Animated swap arrow between the two asset cards.
 * Pending: oscillating ⇄   Executed: ✓ check   Cancelled: ✕ cross
 */
function SwapArrow({ state }: { state: number }) {
  function renderArrowContent() {
    if (state === SWAP_STATE_EXECUTED) {
      return (
        <motion.div
          key="check"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-success"
        >
          {'\u2713'}
        </motion.div>
      );
    }
    if (state === SWAP_STATE_CANCELLED) {
      return (
        <motion.div
          key="cross"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl font-bold text-neutral"
        >
          {'\u2715'}
        </motion.div>
      );
    }
    return (
      <motion.div
        key="arrow"
        animate={{ x: [0, 6, 0] }}
        transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' as const }}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-xl text-info"
      >
        {'\u21C4'}
      </motion.div>
    );
  }

  return (
    <div className="flex shrink-0 items-center justify-center py-2 md:py-0">
      <AnimatePresence mode="wait">
        {renderArrowContent()}
      </AnimatePresence>
    </div>
  );
}
