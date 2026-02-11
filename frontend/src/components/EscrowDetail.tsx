import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import StatusBadge from '@/components/StatusBadge';
import EventTimeline from '@/components/EventTimeline';
import TransactionToast from '@/components/TransactionToast';
import { ConfettiEffect, AnimatedNumber } from '@/components/effects';
import {
  useEscrowDetail,
  useConfirmEscrow,
  useDisputeEscrow,
  useRejectEscrow,
  useArbiterResolve,
  useTimelockRefund,
  useDestroyEscrow,
} from '@/hooks/useEscrow';
import {
  ESCROW_STATE_ACTIVE,
  ESCROW_STATE_DISPUTED,
  ESCROW_STATE_RELEASED,
  ESCROW_STATE_REFUNDED,
} from '@/constants';
import type { ChainEvent, EscrowCreatedEvent } from '@/types';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`;
}

function formatAssetType(type: string): string {
  if (type.includes('sui::SUI')) return 'SUI Coin';
  const parts = type.split('::');
  return parts.length >= 2
    ? `${parts[parts.length - 2]}::${parts[parts.length - 1]}`
    : type;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATE_LABEL: Record<number, string> = {
  [ESCROW_STATE_ACTIVE]: 'Active',
  [ESCROW_STATE_DISPUTED]: 'Disputed',
  [ESCROW_STATE_RELEASED]: 'Released',
  [ESCROW_STATE_REFUNDED]: 'Refunded',
};

// ── Sub-components ──────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-4 py-2.5 border-b border-subtle last:border-b-0">
      <span className="w-36 shrink-0 text-sm text-muted">{label}</span>
      <span className="text-sm text-text-primary break-all">{children}</span>
    </div>
  );
}

/** Reusable action button with loading spinner. */
function ActionButton({
  label,
  onClick,
  loading,
  variant = 'primary',
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
  variant?: 'primary' | 'danger' | 'secondary' | 'warning';
  disabled?: boolean;
  title?: string;
}) {
  const styles: Record<string, string> = {
    primary:
      'gradient-primary text-white shadow-md hover:shadow-lg',
    danger:
      'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100',
    secondary:
      'border border-subtle bg-surface text-text-secondary hover:bg-surface-soft',
    warning:
      'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100',
  };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      whileHover={loading || disabled ? undefined : { scale: 1.02 }}
      whileTap={loading || disabled ? undefined : { scale: 0.98 }}
      title={title}
      className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          Processing...
        </span>
      ) : (
        label
      )}
    </motion.button>
  );
}

// ── Confirm Warning Dialog ──────────────────────────────────────────────────────

function ConfirmWarningDialog({
  open,
  onCancel,
  onConfirm,
  loading,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-text-primary">
                Confirm Escrow
              </h3>
            </div>

            <p className="mb-6 text-sm leading-relaxed text-text-secondary">
              After confirming, you cannot dispute or request timeout refund.
              Assets release only when the other party also confirms.
              Continue?
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="flex-1 rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <motion.button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                whileHover={loading ? undefined : { scale: 1.02 }}
                whileTap={loading ? undefined : { scale: 0.98 }}
                className="flex-1 gradient-primary rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Processing...
                  </span>
                ) : (
                  'Yes, Confirm'
                )}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Action builder (extracted to reduce component size & cognitive complexity) ──

interface EscrowActionContext {
  isCreator: boolean;
  isRecipient: boolean;
  isArbiter: boolean;
  isActive: boolean;
  isDisputed: boolean;
  isTerminal: boolean;
  creatorConfirmed: boolean;
  recipientConfirmed: boolean;
  timeoutPassed: boolean;
}

function buildEscrowActions(
  ctx: EscrowActionContext,
  handlers: {
    onConfirmDialog: () => void;
    onRecipientConfirm: () => void;
    onDispute: () => void;
    onReject: () => void;
    onResolve: (release: boolean) => void;
    onTimelockRefund: () => void;
    onDestroy: () => void;
  },
  loading: {
    confirm: boolean;
    dispute: boolean;
    reject: boolean;
    resolve: boolean;
    timelock: boolean;
    destroy: boolean;
  },
): ReactNode[] {
  const actions: ReactNode[] = [];

  // Creator actions (Active, not confirmed)
  if (ctx.isCreator && ctx.isActive && !ctx.creatorConfirmed) {
    actions.push(
      <ActionButton key="creator-confirm" label="Confirm" onClick={handlers.onConfirmDialog} loading={loading.confirm} variant="primary" />,
      <ActionButton key="creator-dispute" label="Dispute" onClick={handlers.onDispute} loading={loading.dispute} variant="danger" />,
    );
    if (ctx.timeoutPassed) {
      actions.push(
        <ActionButton key="creator-timelock" label="Timelock Refund" onClick={handlers.onTimelockRefund} loading={loading.timelock} variant="warning" />,
      );
    }
  }

  // Recipient actions (Active, not confirmed)
  if (ctx.isRecipient && ctx.isActive && !ctx.recipientConfirmed) {
    actions.push(
      <ActionButton key="recipient-confirm" label="Confirm" onClick={handlers.onRecipientConfirm} loading={loading.confirm} variant="primary" />,
      <ActionButton key="recipient-dispute" label="Dispute" onClick={handlers.onDispute} loading={loading.dispute} variant="danger" />,
      <ActionButton key="recipient-reject" label="Reject" onClick={handlers.onReject} loading={loading.reject} variant="danger" />,
    );
  }

  // Arbiter actions (Disputed)
  if (ctx.isArbiter && ctx.isDisputed) {
    actions.push(
      <ActionButton key="arbiter-release" label="Resolve: Release to Recipient" onClick={() => handlers.onResolve(true)} loading={loading.resolve} variant="primary" />,
      <ActionButton key="arbiter-refund" label="Resolve: Refund to Creator" onClick={() => handlers.onResolve(false)} loading={loading.resolve} variant="warning" />,
    );
  }

  // Anyone can destroy terminal escrows
  if (ctx.isTerminal) {
    actions.push(
      <ActionButton key="destroy" label="Destroy (Reclaim Storage)" onClick={handlers.onDestroy} loading={loading.destroy} variant="secondary" />,
    );
  }

  return actions;
}

// ── Destroyed fallback ──────────────────────────────────────────────────────────

function DestroyedEscrowView({ id, events }: { id: string; events: ChainEvent[] }) {
  const createEvent = events.find((e) => e.type.includes('EscrowCreated'));
  const json = createEvent?.parsedJson as EscrowCreatedEvent | undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="rounded-2xl border border-subtle bg-surface p-6 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-bold text-text-primary">
            Escrow <span className="font-mono text-base text-muted">{truncateAddress(id)}</span>
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Destroyed
          </span>
        </div>

        {json && (
          <div className="mb-6 rounded-xl border border-subtle bg-surface-soft p-5">
            <DetailRow label="Creator">
              <span className="font-mono text-xs" title={json.creator}>{truncateAddress(json.creator)}</span>
            </DetailRow>
            <DetailRow label="Recipient">
              <span className="font-mono text-xs" title={json.recipient}>{truncateAddress(json.recipient)}</span>
            </DetailRow>
            <DetailRow label="Arbiter">
              <span className="font-mono text-xs" title={json.arbiter}>{truncateAddress(json.arbiter)}</span>
            </DetailRow>
            <DetailRow label="Description">{json.description || '\u2014'}</DetailRow>
          </div>
        )}

        <div>
          <h3 className="mb-4 font-display text-base font-semibold text-text-primary">Event Timeline</h3>
          <EventTimeline events={events} />
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

interface EscrowDetailProps {
  id: string;
}

/** Full escrow detail view with role-based actions and event timeline. */
export default function EscrowDetail({ id }: EscrowDetailProps) {
  const account = useCurrentAccount();
  const { escrow, events, loading, error, destroyed, refetch } = useEscrowDetail(id);
  const confirmHook = useConfirmEscrow();
  const disputeHook = useDisputeEscrow();
  const rejectHook = useRejectEscrow();
  const resolveHook = useArbiterResolve();
  const timelockHook = useTimelockRefund();
  const destroyHook = useDestroyEscrow();

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // ── Celebration & feedback state ──
  const [showConfetti, setShowConfetti] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const prevStateRef = useRef<number | null>(null);
  const escrowState = escrow?.state;

  // Detect escrow state transition to Released → trigger celebration
  useEffect(() => {
    if (escrowState === undefined) return;
    const shouldCelebrate = prevStateRef.current !== null
      && prevStateRef.current !== escrowState
      && escrowState === ESCROW_STATE_RELEASED;
    prevStateRef.current = escrowState;
    if (!shouldCelebrate) return;
    // Defer setState to avoid synchronous call in effect body
    const t = setTimeout(() => {
      setShowConfetti(true);
      setShowHighlight(true);
    }, 0);
    return () => clearTimeout(t);
  }, [escrowState]);

  // Auto-dismiss highlight ring after confetti completes
  useEffect(() => {
    if (showHighlight) {
      const timer = setTimeout(() => setShowHighlight(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [showHighlight]);

  const handleToastDone = useCallback(() => setShowToast(false), []);

  // Live timestamp for timeout expiry checks (avoids impure Date.now during render)
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

  // Aggregate action errors for display
  const actionError =
    confirmHook.error ?? disputeHook.error ?? rejectHook.error ??
    resolveHook.error ?? timelockHook.error ?? destroyHook.error;

  // Refresh data after any successful action, show transaction toast
  async function withRefetch(action: () => Promise<unknown>) {
    setShowToast(true);
    await action();
    refetch();
  }

  // ── Loading / Error states ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="h-10 w-10 animate-spin rounded-full border-3 border-subtle border-t-info" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-rose-50 p-8 text-center">
        <p className="text-sm text-danger">{error.message}</p>
      </div>
    );
  }

  if (destroyed && !escrow) return <DestroyedEscrowView id={id} events={events} />;

  if (!escrow) return null;

  // ── Role detection ──

  const userAddress = account?.address;
  const isCreator = userAddress === escrow.creator;
  const isRecipient = userAddress === escrow.recipient;
  const isArbiter = userAddress === escrow.arbiter;

  const isActive = escrow.state === ESCROW_STATE_ACTIVE;
  const isDisputed = escrow.state === ESCROW_STATE_DISPUTED;
  const isTerminal =
    escrow.state === ESCROW_STATE_RELEASED || escrow.state === ESCROW_STATE_REFUNDED;

  const timeoutPassed = now > escrow.created_at + escrow.timeout_ms;
  const expiresAt = escrow.created_at + escrow.timeout_ms;
  const itemType = escrow.item_type;

  // ── Action handlers ──

  async function handleCreatorConfirm() {
    await withRefetch(() => confirmHook.execute(id, itemType));
    setShowConfirmDialog(false);
  }

  async function handleRecipientConfirm() {
    await withRefetch(() => confirmHook.execute(id, itemType));
  }

  async function handleDispute() {
    await withRefetch(() => disputeHook.execute(id, itemType));
  }

  async function handleReject() {
    await withRefetch(() => rejectHook.execute(id, itemType));
  }

  async function handleResolve(releaseToRecipient: boolean) {
    await withRefetch(() => resolveHook.execute(id, releaseToRecipient, itemType));
  }

  async function handleTimelockRefund() {
    await withRefetch(() => timelockHook.execute(id, itemType));
  }

  async function handleDestroy() {
    await withRefetch(() => destroyHook.execute(id, itemType));
  }

  // ── Build action buttons list ──

  const actions = buildEscrowActions(
    {
      isCreator, isRecipient, isArbiter,
      isActive, isDisputed, isTerminal,
      creatorConfirmed: escrow.creator_confirmed,
      recipientConfirmed: escrow.recipient_confirmed,
      timeoutPassed,
    },
    {
      onConfirmDialog: () => setShowConfirmDialog(true),
      onRecipientConfirm: handleRecipientConfirm,
      onDispute: handleDispute,
      onReject: handleReject,
      onResolve: handleResolve,
      onTimelockRefund: handleTimelockRefund,
      onDestroy: handleDestroy,
    },
    {
      confirm: confirmHook.loading,
      dispute: disputeHook.loading,
      reject: rejectHook.loading,
      resolve: resolveHook.loading,
      timelock: timelockHook.loading,
      destroy: destroyHook.loading,
    },
  );

  // Timeout in hours for animated display
  const timeoutHours = escrow.timeout_ms / 3_600_000;
  const timeoutDecimals = escrow.timeout_ms % 3_600_000 === 0 ? 0 : 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="lg:flex lg:gap-8">
        {/* ── Main content ── */}
        <div className="flex-1">
          <div className={`rounded-2xl border bg-surface p-6 sm:p-8 transition-all duration-500 ${showHighlight ? 'border-success ring-2 ring-success/30 shadow-lg shadow-success/10' : 'border-subtle'}`}>
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-bold text-text-primary">
                Escrow{' '}
                <span className="font-mono text-base text-muted" title={escrow.id}>
                  {truncateAddress(escrow.id)}
                </span>
              </h2>
              <StatusBadge status={escrow.state} module="escrow" />
            </div>

            {/* Detail fields */}
            <div className="mb-6 rounded-xl border border-subtle bg-surface-soft p-5">
              <DetailRow label="Creator">
                <span className="font-mono text-xs" title={escrow.creator}>
                  {truncateAddress(escrow.creator)}
                  {isCreator && <span className="ml-2 text-info font-sans">(you)</span>}
                </span>
              </DetailRow>
              <DetailRow label="Recipient">
                <span className="font-mono text-xs" title={escrow.recipient}>
                  {truncateAddress(escrow.recipient)}
                  {isRecipient && <span className="ml-2 text-info font-sans">(you)</span>}
                </span>
              </DetailRow>
              <DetailRow label="Arbiter">
                <span className="font-mono text-xs" title={escrow.arbiter}>
                  {truncateAddress(escrow.arbiter)}
                  {isArbiter && <span className="ml-2 text-info font-sans">(you)</span>}
                </span>
              </DetailRow>
              <DetailRow label="Asset Type">{formatAssetType(escrow.item_type)}</DetailRow>
              <DetailRow label="Description">{escrow.description || '\u2014'}</DetailRow>
              <DetailRow label="Status">
                {STATE_LABEL[escrow.state] ?? 'Unknown'}
              </DetailRow>
              <DetailRow label="Creator Confirmed">
                <ConfirmBadge confirmed={escrow.creator_confirmed} />
              </DetailRow>
              <DetailRow label="Recipient Confirmed">
                <ConfirmBadge confirmed={escrow.recipient_confirmed} />
              </DetailRow>
              <DetailRow label="Created">{formatDate(escrow.created_at)}</DetailRow>
              <DetailRow label="Timeout">
                <span className="font-display font-semibold">
                  <AnimatedNumber value={timeoutHours} decimals={timeoutDecimals} />
                </span>
                <span className="ml-0.5 text-text-secondary">hours</span>
                {isActive && (
                  <span className={`ml-2 text-xs ${timeoutPassed ? 'text-danger' : 'text-muted'}`}>
                    ({timeoutPassed ? 'expired' : `expires ${formatDate(expiresAt)}`})
                  </span>
                )}
              </DetailRow>
              {escrow.disputed_at > 0 && (
                <DetailRow label="Disputed At">{formatDate(escrow.disputed_at)}</DetailRow>
              )}
            </div>

            {/* Action error display */}
            {actionError && (
              <div className="mb-6 rounded-lg border border-danger/30 bg-rose-50 px-4 py-3 text-sm text-danger">
                {actionError.message}
              </div>
            )}

            {/* ── Mobile action buttons (visible on <lg) ── */}
            {actions.length > 0 && (
              <div className="mb-6 space-y-2.5 lg:hidden">
                <h3 className="text-sm font-semibold text-text-secondary">Actions</h3>
                {actions}
              </div>
            )}

            {/* ── Event Timeline ── */}
            <div>
              <h3 className="mb-4 font-display text-base font-semibold text-text-primary">
                Event Timeline
              </h3>
              <EventTimeline events={events} />
            </div>
          </div>
        </div>

        {/* ── Desktop action sidebar (visible on ≥lg) ── */}
        {actions.length > 0 && (
          <aside className="hidden lg:block lg:w-72 lg:shrink-0">
            <div className="sticky top-24 space-y-3 rounded-2xl border border-subtle bg-surface p-5">
              <h3 className="text-sm font-semibold text-text-secondary">Actions</h3>
              {actions}
            </div>
          </aside>
        )}
      </div>

      {/* Creator confirm warning dialog */}
      <ConfirmWarningDialog
        open={showConfirmDialog}
        onCancel={() => setShowConfirmDialog(false)}
        onConfirm={handleCreatorConfirm}
        loading={confirmHook.loading}
      />

      {/* Celebration effects */}
      {showConfetti && (
        <ConfettiEffect onComplete={() => setShowConfetti(false)} />
      )}
      <TransactionToast visible={showToast} onDone={handleToastDone} />
    </motion.div>
  );
}

// ── Tiny confirm indicator ──────────────────────────────────────────────────────

function ConfirmBadge({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Yes
    </span>
  ) : (
    <span className="text-muted">No</span>
  );
}
