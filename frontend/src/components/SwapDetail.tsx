import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import {
  useSwapDetail,
  useExecuteSwap,
  useCancelSwap,
  useDestroySwap,
} from '@/hooks/useSwap';
import {
  useObjectSwapDetail,
  useExecuteObjectSwap,
  useCancelObjectSwap,
  useDestroyObjectSwap,
} from '@/hooks/useObjectSwap';
import {
  SWAP_STATE_PENDING,
  SWAP_STATE_EXECUTED,
  SWAP_STATE_CANCELLED,
} from '@/constants';
import type { SwapObject, ObjectSwapObject, ChainEvent } from '@/types';
import StatusBadge from './StatusBadge';
import EventTimeline from './EventTimeline';
import TransactionToast from './TransactionToast';
import { ConfettiEffect, ParticleEffect, AnimatedNumber } from '@/components/effects';

// ── Helpers ──────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

/** Matches the inner SUI coin type regardless of address zero-padding. */
const SUI_TYPE_RE = /^0x0*2::sui::SUI$/;

function isSuiType(type: string): boolean {
  return SUI_TYPE_RE.test(type);
}

function shortType(type: string): string {
  if (!type) return 'Unknown';
  if (SUI_TYPE_RE.test(type)) return 'SUI';
  const open = type.indexOf('<');
  const base = open === -1 ? type : type.slice(0, open);
  const parts = base.split('::');
  return parts.slice(-2).join('::');
}

/** Display-friendly short name for a coin inner type (e.g. "SUI", "USDC"). */
function shortCoinName(coinType: string): string {
  if (SUI_TYPE_RE.test(coinType)) return 'SUI';
  const parts = coinType.split('::');
  return parts[parts.length - 1] ?? coinType;
}

/** Format MIST (u64 string) as human-readable SUI decimal. */
function formatMist(mist: string): string {
  const value = BigInt(mist || '0');
  const whole = value / 1_000_000_000n;
  const frac = value % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

function suiToMist(sui: number): bigint {
  return BigInt(Math.round(sui * 1_000_000_000));
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

// ── Hooks ────────────────────────────────────────────────────────────

const JSON_RPC_URL = 'https://fullnode.testnet.sui.io:443';

/** Triggers celebration effects when swap transitions to Executed. */
function useCelebration(swapState: number | undefined) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [showParticles, setShowParticles] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const prevStateRef = useRef<number | null>(null);

  useEffect(() => {
    if (swapState === undefined) return;
    const shouldCelebrate =
      prevStateRef.current !== null &&
      prevStateRef.current !== swapState &&
      swapState === SWAP_STATE_EXECUTED;
    prevStateRef.current = swapState;
    if (!shouldCelebrate) return;
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

/** Fetch the SUI balance (in MIST) for an address. Returns null while loading or on error. */
function useSuiBalance(address: string | undefined): bigint | null {
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(JSON_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'suix_getBalance',
            params: [address, '0x2::sui::SUI'],
          }),
        });
        const body = (await res.json()) as { result?: { totalBalance: string } };
        if (!cancelled) setBalance(BigInt(body.result?.totalBalance ?? '0'));
      } catch {
        if (!cancelled) setBalance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  return balance;
}

// ── Main Component ───────────────────────────────────────────────────

interface SwapDetailProps {
  swapId: string;
  /**
   * Which contract module this swap belongs to.
   * Routes to different hooks and rendering paths.
   * Defaults to 'coin'; callers should pass the explicit kind from
   * route state or type-string detection when available.
   */
  swapKind?: 'coin' | 'object';
}

/**
 * Swap detail view — supports both Coin Swaps (NFT-for-Coin) and
 * Object Swaps (NFT-for-NFT). Routes to the appropriate inner
 * component based on `swapKind` to satisfy React's rules of hooks.
 */
export default function SwapDetail({ swapId, swapKind = 'coin' }: SwapDetailProps) {
  if (swapKind === 'object') {
    return <ObjectSwapDetailInner swapId={swapId} />;
  }
  return <CoinSwapDetailInner swapId={swapId} />;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── Coin Swap Detail (NFT → Coin) ───────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function CoinSwapDetailInner({ swapId }: { swapId: string }) {
  const account = useCurrentAccount();
  const { data: swap, events, loading, error, refetch } = useSwapDetail(swapId);

  const executeSwap = useExecuteSwap();
  const cancelSwap = useCancelSwap();
  const destroySwap = useDestroySwap();

  // Countdown — ticks every second while swap is pending
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const raf = requestAnimationFrame(update);
    const timer = setInterval(update, 1_000);
    return () => { cancelAnimationFrame(raf); clearInterval(timer); };
  }, []);

  // Local action UI state
  type SwapAction = 'execute' | 'cancel' | 'destroy' | null;
  const [activeAction, setActiveAction] = useState<SwapAction>(null);
  const [executeSuiAmount, setExecuteSuiAmount] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Celebration effects
  const { showConfetti, setShowConfetti, showParticles, setShowParticles, showHighlight } =
    useCelebration(swap?.state);
  const [showToast, setShowToast] = useState(false);
  const handleToastDone = useCallback(() => setShowToast(false), []);

  // Balance check — only fetch for SUI when connected wallet is the recipient
  const isSui = swap ? isSuiType(swap.coin_type) : false;
  const balanceAddress =
    isSui && account?.address && swap && account.address === swap.recipient
      ? account.address
      : undefined;
  const suiBalance = useSuiBalance(balanceAddress);

  // ── Loading / error states ──

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorDisplay error={error} />;
  if (!swap) return <NotFound />;

  // ── Derived state ──

  const isDestroyed = events.some((e) => e.type.endsWith('::SwapDestroyed'));
  const isCreator = account?.address === swap.creator;
  const isRecipient = account?.address === swap.recipient;
  const isPending = swap.state === SWAP_STATE_PENDING;
  const isExecuted = swap.state === SWAP_STATE_EXECUTED;
  const isCancelled = swap.state === SWAP_STATE_CANCELLED;
  const isSwapped = isExecuted;

  const deadline = swap.created_at + swap.timeout_ms;
  const remaining = Math.max(0, deadline - now);
  const isTimedOut = remaining <= 0;

  const canExecute = isRecipient && isPending && !isDestroyed;
  const canCancel = isCreator && isPending && isTimedOut && !isDestroyed;
  const canDestroy = (isExecuted || isCancelled) && !isDestroyed;
  const hasAnyAction = canExecute || canCancel || canDestroy;

  const timeoutHours = swap.timeout_ms / 3_600_000;
  const timeoutDecimals = swap.timeout_ms % 3_600_000 === 0 ? 0 : 1;

  // Balance insufficiency — only applies for SUI
  const requestedMist = BigInt(swap.requested_amount || '0');
  const insufficientBalance = isSui && suiBalance !== null && suiBalance < requestedMist;

  // Display amounts
  const requestedSui = formatMist(swap.requested_amount);
  const coinName = shortCoinName(swap.coin_type);
  // Default to exact requested amount; user can edit to overpay
  const effectiveAmountStr = executeSuiAmount || requestedSui;

  // Post-execution: extract amount_paid from SwapExecuted event
  const executedEvent = events.find((e) => e.type.endsWith('::SwapExecuted'));
  const amountPaid = executedEvent?.parsedJson?.amount_paid as string | undefined;

  // ── Action handlers ──

  const clearAction = () => {
    setActiveAction(null);
    setActionError(null);
    setExecuteSuiAmount('');
  };

  const runAction = async (action: () => Promise<unknown>, msg: string) => {
    setActionError(null);
    setShowToast(true);
    try {
      await action();
      clearAction();
      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(null), 5_000);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExecute = () =>
    runAction(
      () =>
        executeSwap.execute({
          swapObjectId: swap.id,
          itemType: swap.item_type,
          coinType: swap.coin_type,
          paymentAmount: suiToMist(parseFloat(effectiveAmountStr)),
        }),
      'Swap executed successfully!',
    );

  const handleCancel = () =>
    runAction(
      () =>
        cancelSwap.execute({
          swapObjectId: swap.id,
          itemType: swap.item_type,
          coinType: swap.coin_type,
        }),
      'Swap cancelled. Asset returned to creator.',
    );

  const handleDestroy = () =>
    runAction(
      () =>
        destroySwap.execute({
          swapObjectId: swap.id,
          itemType: swap.item_type,
          coinType: swap.coin_type,
        }),
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
      <SwapHeader
        swapId={swapId}
        state={swap.state}
        isDestroyed={isDestroyed}
        description={swap.description}
        label="Coin Swap"
      />

      {/* Dual-column: Creator's NFT ↔ Coin Price */}
      <CoinAssetComparison
        swap={swap}
        isSwapped={isSwapped}
        isCreator={isCreator}
        isRecipient={isRecipient}
        showHighlight={showHighlight}
        showParticles={showParticles}
        amountPaid={amountPaid}
        onParticlesDone={() => setShowParticles(false)}
      />

      {/* Timeout countdown */}
      {isPending && !isDestroyed && (
        <CountdownBar
          remaining={remaining}
          isTimedOut={isTimedOut}
          isCreator={isCreator}
          timeoutHours={timeoutHours}
          timeoutDecimals={timeoutDecimals}
        />
      )}

      <SuccessBanner message={successMessage} />

      {/* Role-based actions */}
      {hasAnyAction && (
        <div className="rounded-2xl border border-subtle bg-surface p-6">
          <h3 className="mb-4 font-display text-lg font-semibold">Actions</h3>

          <ActionButtons
            canExecute={canExecute}
            canCancel={canCancel}
            canDestroy={canDestroy}
            activeAction={activeAction}
            setActiveAction={setActiveAction}
            anyActionLoading={anyActionLoading}
          />

          <AnimatePresence mode="wait">
            {activeAction === 'execute' && (
              <ExpandableForm formKey="coin-execute" borderClass="border-info/20" bgClass="bg-indigo-50">
                <p className="text-sm font-medium text-text-primary">
                  Pay{' '}
                  <span className="font-display font-bold text-info">
                    {'\u2265'} {requestedSui} {coinName}
                  </span>{' '}
                  to complete the swap:
                </p>

                {/* Non-SUI warning — splitCoins(tx.gas) only works for SUI */}
                {!isSui && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Only SUI payments are supported in this version.
                  </div>
                )}

                {/* Balance feedback */}
                {isSui && insufficientBalance && (
                  <div className="rounded-lg border border-danger/20 bg-rose-50 px-3 py-2 text-xs text-danger">
                    Insufficient balance. You have{' '}
                    <span className="font-mono font-semibold">
                      {formatMist(suiBalance!.toString())}
                    </span>{' '}
                    SUI but need {'\u2265'}{' '}
                    <span className="font-mono font-semibold">{requestedSui}</span> SUI.
                  </div>
                )}
                {isSui && suiBalance !== null && !insufficientBalance && (
                  <p className="text-xs text-muted">
                    Your balance:{' '}
                    <span className="font-mono font-semibold">
                      {formatMist(suiBalance.toString())}
                    </span>{' '}
                    SUI
                  </p>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                    Payment Amount ({coinName})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    placeholder={requestedSui}
                    value={executeSuiAmount}
                    onChange={(e) => setExecuteSuiAmount(e.target.value)}
                    className="w-full rounded-xl border border-subtle bg-white px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-info/30 transition"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Minimum: {requestedSui} {coinName}. You may overpay.
                  </p>
                </div>

                {actionError && <p className="text-sm text-danger">{actionError}</p>}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleExecute}
                    disabled={
                      executeSwap.loading ||
                      !isSui ||
                      insufficientBalance ||
                      isNaN(parseFloat(effectiveAmountStr)) ||
                      parseFloat(effectiveAmountStr) <= 0
                    }
                    className="rounded-xl gradient-swap px-6 py-2.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {executeSwap.loading ? <LoadingButtonContent /> : 'Confirm Payment'}
                  </button>
                  <button
                    type="button"
                    onClick={clearAction}
                    disabled={executeSwap.loading}
                    className="rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </ExpandableForm>
            )}

            {activeAction === 'cancel' && (
              <CancelConfirmForm
                actionError={actionError}
                loading={cancelSwap.loading}
                onConfirm={handleCancel}
                onBack={clearAction}
              />
            )}

            {activeAction === 'destroy' && (
              <DestroyConfirmForm
                actionError={actionError}
                loading={destroySwap.loading}
                onConfirm={handleDestroy}
                onBack={clearAction}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      <TimelineSection events={events} />

      {showConfetti && <ConfettiEffect onComplete={() => setShowConfetti(false)} />}
      <TransactionToast visible={showToast} onDone={handleToastDone} />
    </motion.div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── Object Swap Detail (NFT ⇄ NFT) ─────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ObjectSwapDetailInner({ swapId }: { swapId: string }) {
  const account = useCurrentAccount();
  const { data: swap, events, loading, error, refetch } = useObjectSwapDetail(swapId);

  const executeSwap = useExecuteObjectSwap();
  const cancelSwap = useCancelObjectSwap();
  const destroySwap = useDestroyObjectSwap();

  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const raf = requestAnimationFrame(update);
    const timer = setInterval(update, 1_000);
    return () => { cancelAnimationFrame(raf); clearInterval(timer); };
  }, []);

  type SwapAction = 'execute' | 'cancel' | 'destroy' | null;
  const [activeAction, setActiveAction] = useState<SwapAction>(null);
  const [executeAssetId, setExecuteAssetId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { showConfetti, setShowConfetti, showParticles, setShowParticles, showHighlight } =
    useCelebration(swap?.state);
  const [showToast, setShowToast] = useState(false);
  const handleToastDone = useCallback(() => setShowToast(false), []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorDisplay error={error} />;
  if (!swap) return <NotFound />;

  // ── Derived state ──

  const isDestroyed = events.some((e) => e.type.endsWith('::ObjectSwapDestroyed'));
  const isCreator = account?.address === swap.creator;
  const isRecipient = account?.address === swap.recipient;
  const isPending = swap.state === SWAP_STATE_PENDING;
  const isExecuted = swap.state === SWAP_STATE_EXECUTED;
  const isCancelled = swap.state === SWAP_STATE_CANCELLED;
  const isSwapped = isExecuted;

  const deadline = swap.created_at + swap.timeout_ms;
  const remaining = Math.max(0, deadline - now);
  const isTimedOut = remaining <= 0;

  const canExecute = isRecipient && isPending && !isDestroyed;
  const canCancel = isCreator && isPending && isTimedOut && !isDestroyed;
  const canDestroy = (isExecuted || isCancelled) && !isDestroyed;
  const hasAnyAction = canExecute || canCancel || canDestroy;

  const timeoutHours = swap.timeout_ms / 3_600_000;
  const timeoutDecimals = swap.timeout_ms % 3_600_000 === 0 ? 0 : 1;

  // ── Action handlers ──

  const clearAction = () => {
    setActiveAction(null);
    setActionError(null);
    setExecuteAssetId('');
  };

  const openExecuteForm = () => {
    // Pre-fill with required object ID when specified
    if (swap.requested_object_id && !executeAssetId) {
      setExecuteAssetId(swap.requested_object_id);
    }
    setActiveAction('execute');
  };

  const runAction = async (action: () => Promise<unknown>, msg: string) => {
    setActionError(null);
    setShowToast(true);
    try {
      await action();
      clearAction();
      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(null), 5_000);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExecute = () =>
    runAction(
      () =>
        executeSwap.execute({
          swapObjectId: swap.id,
          creatorItemType: swap.item_type,
          counterItemType: swap.counter_item_type,
          itemBObjectId: executeAssetId,
        }),
      'Object swap executed successfully!',
    );

  const handleCancel = () =>
    runAction(
      () =>
        cancelSwap.execute({
          swapObjectId: swap.id,
          creatorItemType: swap.item_type,
          counterItemType: swap.counter_item_type,
        }),
      'Swap cancelled. Asset returned to creator.',
    );

  const handleDestroy = () =>
    runAction(
      () =>
        destroySwap.execute({
          swapObjectId: swap.id,
          creatorItemType: swap.item_type,
          counterItemType: swap.counter_item_type,
        }),
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
      <SwapHeader
        swapId={swapId}
        state={swap.state}
        isDestroyed={isDestroyed}
        description={swap.description}
        label="Object Swap"
      />

      {/* Dual-column: Creator's Asset ⇄ Requested Object */}
      <ObjectAssetComparison
        swap={swap}
        isSwapped={isSwapped}
        isCreator={isCreator}
        isRecipient={isRecipient}
        showHighlight={showHighlight}
        showParticles={showParticles}
        onParticlesDone={() => setShowParticles(false)}
      />

      {isPending && !isDestroyed && (
        <CountdownBar
          remaining={remaining}
          isTimedOut={isTimedOut}
          isCreator={isCreator}
          timeoutHours={timeoutHours}
          timeoutDecimals={timeoutDecimals}
        />
      )}

      <SuccessBanner message={successMessage} />

      {hasAnyAction && (
        <div className="rounded-2xl border border-subtle bg-surface p-6">
          <h3 className="mb-4 font-display text-lg font-semibold">Actions</h3>

          <div className="flex flex-wrap gap-3">
            {canExecute && (
              <button
                type="button"
                onClick={() =>
                  activeAction === 'execute' ? setActiveAction(null) : openExecuteForm()
                }
                disabled={anyActionLoading}
                className="rounded-xl gradient-swap px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Execute Swap
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() =>
                  setActiveAction(activeAction === 'cancel' ? null : 'cancel')
                }
                disabled={anyActionLoading}
                className="rounded-xl border border-danger/30 bg-rose-50 px-6 py-3 font-semibold text-danger transition hover:bg-rose-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Cancel Swap
              </button>
            )}
            {canDestroy && (
              <button
                type="button"
                onClick={() =>
                  setActiveAction(activeAction === 'destroy' ? null : 'destroy')
                }
                disabled={anyActionLoading}
                className="rounded-xl border border-subtle px-6 py-3 font-semibold text-text-secondary transition hover:bg-surface-soft active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Destroy (Reclaim Storage)
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {activeAction === 'execute' && (
              <ExpandableForm formKey="obj-execute" borderClass="border-info/20" bgClass="bg-indigo-50">
                <p className="text-sm font-medium text-text-primary">
                  Provide your counter-asset to complete the swap:
                </p>

                {swap.requested_object_id ? (
                  <div className="rounded-lg border border-info/20 bg-indigo-50/50 px-3 py-2 text-xs text-info">
                    This swap requires a specific object:{' '}
                    <span className="font-mono font-semibold">
                      {truncateAddress(swap.requested_object_id)}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Any object of type{' '}
                    <span className="font-mono font-semibold">
                      {shortType(swap.counter_item_type)}
                    </span>{' '}
                    is accepted.
                  </p>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                    Your Object ID ({shortType(swap.counter_item_type)})
                  </label>
                  <input
                    type="text"
                    placeholder="0x\u2026"
                    value={executeAssetId}
                    onChange={(e) => setExecuteAssetId(e.target.value)}
                    className="w-full rounded-xl border border-subtle bg-white px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-info/30 transition"
                  />
                </div>

                {actionError && <p className="text-sm text-danger">{actionError}</p>}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleExecute}
                    disabled={executeSwap.loading || !executeAssetId}
                    className="rounded-xl gradient-swap px-6 py-2.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {executeSwap.loading ? <LoadingButtonContent /> : 'Confirm Execute'}
                  </button>
                  <button
                    type="button"
                    onClick={clearAction}
                    disabled={executeSwap.loading}
                    className="rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </ExpandableForm>
            )}

            {activeAction === 'cancel' && (
              <CancelConfirmForm
                actionError={actionError}
                loading={cancelSwap.loading}
                onConfirm={handleCancel}
                onBack={clearAction}
              />
            )}

            {activeAction === 'destroy' && (
              <DestroyConfirmForm
                actionError={actionError}
                loading={destroySwap.loading}
                onConfirm={handleDestroy}
                onBack={clearAction}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      <TimelineSection events={events} />

      {showConfetti && <ConfettiEffect onComplete={() => setShowConfetti(false)} />}
      <TransactionToast visible={showToast} onDone={handleToastDone} />
    </motion.div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── Shared Sub-Components ───────────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-info border-t-transparent" />
    </div>
  );
}

function ErrorDisplay({ error }: { error: Error }) {
  return (
    <div className="rounded-2xl border border-danger/30 bg-rose-50 p-8 text-center">
      <p className="font-semibold text-danger">Failed to load swap</p>
      <p className="mt-1 text-sm text-danger/80">{error.message}</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-2xl border border-subtle bg-surface-soft p-12 text-center">
      <p className="text-lg font-semibold text-text-primary">Swap not found</p>
      <p className="mt-1 text-sm text-muted">
        This swap may have been destroyed or does not exist.
      </p>
    </div>
  );
}

/** Swap title with truncated ID, kind label, status badge, and optional description. */
function SwapHeader({
  swapId,
  state,
  isDestroyed,
  description,
  label,
}: {
  swapId: string;
  state: number;
  isDestroyed: boolean;
  description?: string;
  label: string;
}) {
  return (
    <>
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold sm:text-3xl">
          {label}{' '}
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
        <p className="text-center text-sm text-text-secondary">{description}</p>
      )}
    </>
  );
}

function CountdownBar({
  remaining,
  isTimedOut,
  isCreator,
  timeoutHours,
  timeoutDecimals,
}: {
  remaining: number;
  isTimedOut: boolean;
  isCreator: boolean;
  timeoutHours: number;
  timeoutDecimals: number;
}) {
  return (
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
        Total:{' '}
        <span className="font-display font-semibold">
          <AnimatedNumber value={timeoutHours} decimals={timeoutDecimals} />
        </span>{' '}
        hours
      </p>
      {isTimedOut && isCreator && (
        <p className="mt-1 text-xs text-muted">
          You can now cancel this swap and reclaim your asset.
        </p>
      )}
    </div>
  );
}

function SuccessBanner({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="rounded-xl border border-success/30 bg-emerald-50 p-4 text-center text-sm font-semibold text-success"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TimelineSection({ events }: { events: ChainEvent[] }) {
  return (
    <div className="rounded-2xl border border-subtle bg-surface p-6">
      <h3 className="mb-4 font-display text-lg font-semibold">Event Timeline</h3>
      <EventTimeline events={events} />
    </div>
  );
}

/** Shared action button row for execute / cancel / destroy. */
function ActionButtons({
  canExecute,
  canCancel,
  canDestroy,
  activeAction,
  setActiveAction,
  anyActionLoading,
}: {
  canExecute: boolean;
  canCancel: boolean;
  canDestroy: boolean;
  activeAction: string | null;
  setActiveAction: (a: 'execute' | 'cancel' | 'destroy' | null) => void;
  anyActionLoading: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {canExecute && (
        <button
          type="button"
          onClick={() =>
            setActiveAction(activeAction === 'execute' ? null : 'execute')
          }
          disabled={anyActionLoading}
          className="rounded-xl gradient-swap px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Execute Swap
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={() =>
            setActiveAction(activeAction === 'cancel' ? null : 'cancel')
          }
          disabled={anyActionLoading}
          className="rounded-xl border border-danger/30 bg-rose-50 px-6 py-3 font-semibold text-danger transition hover:bg-rose-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Cancel Swap
        </button>
      )}
      {canDestroy && (
        <button
          type="button"
          onClick={() =>
            setActiveAction(activeAction === 'destroy' ? null : 'destroy')
          }
          disabled={anyActionLoading}
          className="rounded-xl border border-subtle px-6 py-3 font-semibold text-text-secondary transition hover:bg-surface-soft active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Destroy (Reclaim Storage)
        </button>
      )}
    </div>
  );
}

/** Animated expand/collapse wrapper for action confirmation forms. */
function ExpandableForm({
  formKey,
  borderClass,
  bgClass,
  children,
}: {
  formKey: string;
  borderClass: string;
  bgClass: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      key={formKey}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className={`mt-4 rounded-xl border ${borderClass} ${bgClass} p-5 space-y-4`}>
        {children}
      </div>
    </motion.div>
  );
}

function CancelConfirmForm({
  actionError,
  loading,
  onConfirm,
  onBack,
}: {
  actionError: string | null;
  loading: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <ExpandableForm formKey="cancel-form" borderClass="border-danger/20" bgClass="bg-rose-50">
      <p className="text-sm text-text-primary">
        Cancelling will return the deposited asset to the creator. This action
        cannot be undone.
      </p>
      {actionError && <p className="text-sm text-danger">{actionError}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="rounded-xl bg-danger px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-danger/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? <LoadingButtonContent /> : 'Confirm Cancel'}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
        >
          Go Back
        </button>
      </div>
    </ExpandableForm>
  );
}

function DestroyConfirmForm({
  actionError,
  loading,
  onConfirm,
  onBack,
}: {
  actionError: string | null;
  loading: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <ExpandableForm formKey="destroy-form" borderClass="border-subtle" bgClass="bg-surface-soft">
      <p className="text-sm text-text-primary">
        Destroying reclaims on-chain storage. The swap object will be permanently
        deleted, but all events remain on-chain.
      </p>
      {actionError && <p className="text-sm text-danger">{actionError}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="rounded-xl border border-subtle bg-neutral px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? <LoadingButtonContent /> : 'Confirm Destroy'}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
        >
          Go Back
        </button>
      </div>
    </ExpandableForm>
  );
}

function LoadingButtonContent() {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
      Processing{'\u2026'}
    </span>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── Asset Comparison Components ─────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Single asset card showing type + owner address. */
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

/** Coin price card — shows requested or paid amount instead of a generic asset type. */
function CoinPriceCard({
  coinType,
  requestedAmount,
  amountPaid,
  address,
  title,
  highlight,
  accentClass,
}: {
  coinType: string;
  requestedAmount: string;
  amountPaid?: string;
  address: string;
  title: string;
  highlight: boolean;
  accentClass?: string;
}) {
  const coinName = shortCoinName(coinType);
  const paid = !!amountPaid;

  return (
    <div
      className={`rounded-xl border p-5 text-center transition-colors ${
        accentClass ?? 'border-subtle'
      } ${highlight ? 'bg-indigo-50/60 ring-1 ring-indigo-200' : 'bg-surface-soft'}`}
    >
      {paid ? (
        <>
          <p className="font-display text-lg font-bold text-success">
            {formatMist(amountPaid!)} {coinName}
          </p>
          <p className="mt-1 text-xs text-muted">
            Paid (required: {'\u2265'} {formatMist(requestedAmount)})
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-lg font-bold text-info">
            {'\u2265'} {formatMist(requestedAmount)} {coinName}
          </p>
          <p className="mt-1 text-xs text-muted">Requested payment</p>
        </>
      )}
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

/** Object request card — shows either a required specific ID or "any of type" notice. */
function ObjectRequestCard({
  counterItemType,
  requestedObjectId,
  address,
  title,
  highlight,
  accentClass,
}: {
  counterItemType: string;
  requestedObjectId: string | null;
  address: string;
  title: string;
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
        {shortType(counterItemType)}
      </p>
      {requestedObjectId ? (
        <p className="mt-1.5 inline-block rounded-md bg-surface px-2 py-1 font-mono text-xs text-muted">
          ID: {truncateAddress(requestedObjectId)}
        </p>
      ) : (
        <p className="mt-1.5 text-xs font-medium text-info">
          Any object of this type
        </p>
      )}
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

/** Coin Swap: dual-column showing Creator's NFT ↔ Coin Price. */
function CoinAssetComparison({
  swap,
  isSwapped,
  isCreator,
  isRecipient,
  showHighlight,
  showParticles,
  amountPaid,
  onParticlesDone,
}: {
  swap: SwapObject;
  isSwapped: boolean;
  isCreator: boolean;
  isRecipient: boolean;
  showHighlight: boolean;
  showParticles: boolean;
  amountPaid?: string;
  onParticlesDone: () => void;
}) {
  const accentClass = isSwapped ? 'border-emerald-200' : undefined;

  const creatorCard = (
    <AssetCard
      title="Creator\u2019s Deposit"
      type={swap.item_type}
      address={swap.creator}
      highlight={isCreator}
      accentClass={accentClass}
    />
  );

  const priceCard = (
    <CoinPriceCard
      coinType={swap.coin_type}
      requestedAmount={swap.requested_amount}
      amountPaid={amountPaid}
      address={swap.recipient}
      title={isSwapped ? 'Payment Received' : 'Expected from Recipient'}
      highlight={isRecipient}
      accentClass={accentClass}
    />
  );

  return (
    <div
      className={`rounded-2xl border bg-surface p-6 sm:p-8 transition-all duration-500 ${
        showHighlight
          ? 'border-success ring-2 ring-success/30 shadow-lg shadow-success/10'
          : 'border-subtle'
      }`}
    >
      <LayoutGroup>
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-8">
          {isSwapped ? (
            <>
              <motion.div layout layoutId="coin-recipient" className="w-full flex-1 md:w-auto">
                {priceCard}
              </motion.div>
              <div className="relative">
                <SwapArrow state={swap.state} />
                {showParticles && <ParticleEffect onComplete={onParticlesDone} />}
              </div>
              <motion.div layout layoutId="coin-creator" className="w-full flex-1 md:w-auto">
                {creatorCard}
              </motion.div>
            </>
          ) : (
            <>
              <motion.div layout layoutId="coin-creator" className="w-full flex-1 md:w-auto">
                {creatorCard}
              </motion.div>
              <div className="relative">
                <SwapArrow state={swap.state} />
                {showParticles && <ParticleEffect onComplete={onParticlesDone} />}
              </div>
              <motion.div layout layoutId="coin-recipient" className="w-full flex-1 md:w-auto">
                {priceCard}
              </motion.div>
            </>
          )}
        </div>
      </LayoutGroup>
    </div>
  );
}

/** Object Swap: dual-column showing Creator's Asset ⇄ Requested Object. */
function ObjectAssetComparison({
  swap,
  isSwapped,
  isCreator,
  isRecipient,
  showHighlight,
  showParticles,
  onParticlesDone,
}: {
  swap: ObjectSwapObject;
  isSwapped: boolean;
  isCreator: boolean;
  isRecipient: boolean;
  showHighlight: boolean;
  showParticles: boolean;
  onParticlesDone: () => void;
}) {
  const accentClass = isSwapped ? 'border-emerald-200' : undefined;

  const creatorCard = (
    <AssetCard
      title="Creator\u2019s Deposit"
      type={swap.item_type}
      address={swap.creator}
      highlight={isCreator}
      accentClass={accentClass}
    />
  );

  const requestCard = (
    <ObjectRequestCard
      counterItemType={swap.counter_item_type}
      requestedObjectId={swap.requested_object_id}
      address={swap.recipient}
      title={isSwapped ? 'Recipient\u2019s Counter-Asset' : 'Expected from Recipient'}
      highlight={isRecipient}
      accentClass={accentClass}
    />
  );

  return (
    <div
      className={`rounded-2xl border bg-surface p-6 sm:p-8 transition-all duration-500 ${
        showHighlight
          ? 'border-success ring-2 ring-success/30 shadow-lg shadow-success/10'
          : 'border-subtle'
      }`}
    >
      <LayoutGroup>
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-8">
          {isSwapped ? (
            <>
              <motion.div layout layoutId="obj-recipient" className="w-full flex-1 md:w-auto">
                {requestCard}
              </motion.div>
              <div className="relative">
                <SwapArrow state={swap.state} />
                {showParticles && <ParticleEffect onComplete={onParticlesDone} />}
              </div>
              <motion.div layout layoutId="obj-creator" className="w-full flex-1 md:w-auto">
                {creatorCard}
              </motion.div>
            </>
          ) : (
            <>
              <motion.div layout layoutId="obj-creator" className="w-full flex-1 md:w-auto">
                {creatorCard}
              </motion.div>
              <div className="relative">
                <SwapArrow state={swap.state} />
                {showParticles && <ParticleEffect onComplete={onParticlesDone} />}
              </div>
              <motion.div layout layoutId="obj-recipient" className="w-full flex-1 md:w-auto">
                {requestCard}
              </motion.div>
            </>
          )}
        </div>
      </LayoutGroup>
    </div>
  );
}

/**
 * Animated swap arrow between the two asset cards.
 * Pending: oscillating ⇄   Executed: ✓ check   Cancelled: ✕ cross
 */
function SwapArrow({ state }: { state: number }) {
  function renderContent() {
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
      <AnimatePresence mode="wait">{renderContent()}</AnimatePresence>
    </div>
  );
}
