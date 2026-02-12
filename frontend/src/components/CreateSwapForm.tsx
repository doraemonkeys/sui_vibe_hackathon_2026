import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, animate } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import AssetSelector from './AssetSelector';
import { useCreateSwap } from '@/hooks/useSwap';
import { useCreateObjectSwap } from '../hooks/useObjectSwap';

// ── Constants ──

/** Inner coin type for SUI — NOT the full Coin<> wrapper. */
const SUI_INNER_TYPE = '0x2::sui::SUI';

const SUI_DECIMALS = 9;

/** Supported coin types for the Coin-mode dropdown. Hackathon: SUI only. */
const COIN_OPTIONS = [
  { label: 'SUI', value: SUI_INNER_TYPE, decimals: SUI_DECIMALS, symbol: 'SUI' },
] as const;

const STEP_LABELS = ['Your Asset', 'In Return', 'Details', 'Review'] as const;

// ── Types ──

type SwapMode = 'coin' | 'object';

interface SelectedAsset {
  objectId: string;
  type: string;
  display?: Record<string, string>;
}

// ── Helpers ──

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

/** Matches SUI Coin type regardless of address zero-padding (0x2 vs 0x000…002). */
const SUI_COIN_RE = /::coin::Coin<0x0*2::sui::SUI>/;
const SUI_INNER_RE = /^0x0*2::sui::SUI$/;

function shortType(type: string): string {
  if (!type) return 'Unknown';
  if (SUI_COIN_RE.test(type)) return 'SUI Coin';
  if (SUI_INNER_RE.test(type)) return 'SUI';
  const open = type.indexOf('<');
  const base = open === -1 ? type : type.slice(0, open);
  const parts = base.split('::');
  return parts.slice(-2).join('::');
}

/** Convert a human-readable SUI amount (e.g. "1.5") to MIST string. */
function suiToMist(suiAmount: string): string {
  const num = parseFloat(suiAmount);
  if (isNaN(num) || num <= 0) return '0';
  return Math.floor(num * 10 ** SUI_DECIMALS).toString();
}

// ── Style helpers ──

function stepCursorStyle(i: number, currentStep: number): string {
  if (i < currentStep) return 'cursor-pointer';
  if (i > currentStep) return 'cursor-not-allowed';
  return '';
}

function addressBorderStyle(value: string, isValid: boolean): string {
  if (value && !isValid) return 'border-danger focus:ring-danger/30';
  if (isValid) return 'border-success focus:ring-success/30';
  return 'border-subtle focus:ring-info/30';
}

function inputBorderStyle(isValid: boolean): string {
  return isValid
    ? 'border-success focus:ring-success/30'
    : 'border-subtle focus:ring-info/30';
}

// ── Step transition animation ──

const STEP_MOTION = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.15, ease: 'easeOut' as const },
};

// ── Sub-components ──

function SwapWalletGuard() {
  return (
    <div className="rounded-2xl border border-subtle bg-surface p-12 text-center">
      <p className="mb-2 text-lg font-semibold text-text-primary">
        Connect your wallet
      </p>
      <p className="text-sm text-muted">
        You need a connected wallet to create a swap.
      </p>
    </div>
  );
}

function SwapStepIndicator({ step, onStepClick }: { step: number; onStepClick: (i: number) => void }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-1 sm:gap-2">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => { if (i < step) onStepClick(i); }}
            disabled={i > step}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
              i <= step
                ? 'gradient-primary text-white'
                : 'bg-surface-soft text-muted'
            } ${stepCursorStyle(i, step)}`}
          >
            {i < step ? '\u2713' : i + 1}
          </button>
          <span
            className={`hidden text-sm font-medium sm:inline ${
              i <= step ? 'text-text-primary' : 'text-muted'
            }`}
          >
            {label}
          </span>
          {i < STEP_LABELS.length - 1 && (
            <div
              className={`mx-1 h-px w-6 sm:mx-2 sm:w-10 ${
                i < step ? 'gradient-swap' : 'bg-subtle'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SwapModeSelector({ mode, onChange }: { mode: SwapMode; onChange: (m: SwapMode) => void }) {
  return (
    <div className="mb-6">
      <p className="mb-3 text-sm font-medium text-text-secondary">
        What do you want in return?
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onChange('coin')}
          className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-4 transition-all cursor-pointer ${
            mode === 'coin'
              ? 'border-accent bg-accent/5 shadow-sm'
              : 'border-subtle bg-surface-soft hover:border-muted'
          }`}
        >
          <span className="text-2xl">{'\uD83D\uDCB0'}</span>
          <span className="text-sm font-semibold text-text-primary">Coins</span>
          <span className="text-xs text-muted">SUI, USDC, etc.</span>
        </button>
        <button
          type="button"
          onClick={() => onChange('object')}
          className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-4 transition-all cursor-pointer ${
            mode === 'object'
              ? 'border-accent bg-accent/5 shadow-sm'
              : 'border-subtle bg-surface-soft hover:border-muted'
          }`}
        >
          <span className="text-2xl">{'\uD83C\uDFA8'}</span>
          <span className="text-sm font-semibold text-text-primary">NFT / Object</span>
          <span className="text-xs text-muted">NFT-for-NFT</span>
        </button>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-sm text-text-secondary">{label}</span>
      <span
        className={`text-right text-sm text-text-primary ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Main Component ──

/**
 * Swap creation form — 4-step wizard with dual mode support.
 *
 * Mode "coin":   NFT -> Coin swap  (swap::create_swap)
 * Mode "object": NFT -> NFT swap   (object_swap::create_object_swap)
 *
 * Step 0: Select asset from wallet          (shared)
 * Step 1: Return details                    (mode-specific)
 * Step 2: Recipient, description, timeout   (shared)
 * Step 3: Review & submit                   (mode-specific review)
 */
export default function CreateSwapForm() {
  const navigate = useNavigate();
  const account = useCurrentAccount();

  // Both hooks called unconditionally (React rules); only one fires at submit
  const coinSwap = useCreateSwap();
  const objectSwap = useCreateObjectSwap();

  // ── Form state ──
  const [swapMode, setSwapMode] = useState<SwapMode>('coin');
  const [step, setStep] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset | null>(null);

  // Coin-mode fields
  const [coinType, setCoinType] = useState<string>(COIN_OPTIONS[0].value);
  const [requestedAmount, setRequestedAmount] = useState('');

  // Object-mode fields
  const [counterItemType, setCounterItemType] = useState('');
  const [requestedObjectId, setRequestedObjectId] = useState('');

  // Shared fields (step 2)
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [timeoutHours, setTimeoutHours] = useState(24);

  // Derive loading / error from the active mode's hook
  const loading = swapMode === 'coin' ? coinSwap.loading : objectSwap.loading;
  const error = swapMode === 'coin' ? coinSwap.error : objectSwap.error;

  const selectedCoin = COIN_OPTIONS.find((c) => c.value === coinType) ?? COIN_OPTIONS[0];

  // ── Refs for shake animation ──
  const recipientRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const timeoutRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const counterTypeRef = useRef<HTMLInputElement>(null);

  function shakeElement(el: HTMLElement | null) {
    if (el) animate(el, { x: [0, -8, 8, -6, 6, -3, 3, 0] }, { duration: 0.3 });
  }

  // ── Validation ──
  const isStep0Valid = selectedAsset !== null;

  // Step 1 — mode-specific
  const parsedAmount = parseFloat(requestedAmount);
  const isAmountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const isCounterTypeValid = counterItemType.includes('::');
  const isObjectIdValid =
    requestedObjectId === '' ||
    (requestedObjectId.startsWith('0x') && requestedObjectId.length >= 42);

  const isStep1Valid =
    swapMode === 'coin'
      ? coinType.length > 0 && isAmountValid
      : isCounterTypeValid && isObjectIdValid;

  // Step 2 — shared
  const isValidAddress = recipient.startsWith('0x') && recipient.length >= 42;
  const isDescriptionValid = description.trim().length > 0;
  const isTimeoutFieldValid = timeoutHours > 0;
  const isStep2Valid = isValidAddress && isDescriptionValid && isTimeoutFieldValid;

  // ── Mode switch resets wizard position to avoid stale state ──
  function handleModeChange(mode: SwapMode) {
    setSwapMode(mode);
    if (step > 0) setStep(0);
  }

  // ── Submit ──
  const handleSubmit = async () => {
    if (!selectedAsset || !account) return;
    try {
      if (swapMode === 'coin') {
        await coinSwap.execute({
          itemType: selectedAsset.type,
          coinType,
          recipient,
          requestedAmount: suiToMist(requestedAmount),
          description: description.trim(),
          timeoutMs: timeoutHours * 3_600_000,
          assetObjectId: selectedAsset.objectId,
        });
      } else {
        await objectSwap.execute({
          itemTypeTag: selectedAsset.type,
          counterItemTypeTag: counterItemType,
          itemObjectId: selectedAsset.objectId,
          recipient,
          requestedObjectId: requestedObjectId || undefined,
          description: description.trim(),
          timeoutMs: timeoutHours * 3_600_000,
        });
      }
      navigate('/swaps');
    } catch {
      // Error state managed by the hooks
    }
  };

  if (!account) return <SwapWalletGuard />;

  return (
    <div className="rounded-2xl border border-subtle bg-surface overflow-hidden">
      {/* Top accent band — color varies by mode */}
      <div
        className={`h-1 ${
          swapMode === 'coin'
            ? 'gradient-swap'
            : 'bg-gradient-to-r from-teal-400 to-emerald-500'
        }`}
      />

      <div className="p-6 sm:p-8">
        <SwapModeSelector mode={swapMode} onChange={handleModeChange} />
        <SwapStepIndicator step={step} onStepClick={setStep} />

        {/* ── Step content ── */}
        <AnimatePresence mode="wait">
          {/* Step 0 — Select Asset (shared) */}
          {step === 0 && (
            <motion.div key="step-0" {...STEP_MOTION}>
              <h3 className="mb-4 text-lg font-semibold">Select Your Asset</h3>
              <AssetSelector
                onSelect={(asset) => setSelectedAsset(asset)}
                filterMode={swapMode === 'coin' ? 'nft-only' : 'all'}
              />

              {selectedAsset && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 rounded-xl border border-info/30 bg-indigo-50 p-4"
                >
                  <p className="text-sm font-semibold text-info">Selected</p>
                  <p className="mt-1 font-mono text-xs text-text-secondary">
                    {shortType(selectedAsset.type)}
                  </p>
                  <p className="font-mono text-xs text-muted">
                    {truncateAddress(selectedAsset.objectId)}
                  </p>
                </motion.div>
              )}

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  disabled={!isStep0Valid}
                  onClick={() => setStep(1)}
                  className="rounded-xl gradient-primary px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 1 — Return Details (mode-specific) */}
          {step === 1 && (
            <motion.div key="step-1" {...STEP_MOTION} className="space-y-5">
              <h3 className="text-lg font-semibold">
                {swapMode === 'coin' ? 'Payment Details' : 'Requested Object'}
              </h3>

              {swapMode === 'coin' ? (
                /* ── Coin mode: type selector + amount ── */
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Coin Type
                    </label>
                    <select
                      value={coinType}
                      onChange={(e) => setCoinType(e.target.value)}
                      className="w-full rounded-xl border border-success bg-bg-primary px-4 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-success/30 transition cursor-pointer"
                    >
                      {COIN_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted">
                      More coin types coming soon. Hackathon: SUI only.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Requested Amount ({selectedCoin.symbol})
                    </label>
                    <div className="relative">
                      <input
                        ref={amountRef}
                        type="number"
                        min={0}
                        step="0.001"
                        placeholder="0.00"
                        value={requestedAmount}
                        onChange={(e) => setRequestedAmount(e.target.value)}
                        className={`w-full rounded-xl border bg-bg-primary px-4 py-2.5 pr-16 text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 transition ${inputBorderStyle(isAmountValid)}`}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">
                        {selectedCoin.symbol}
                      </span>
                    </div>
                    {isAmountValid && (
                      <p className="mt-1 text-xs text-muted">
                        = {Number(suiToMist(requestedAmount)).toLocaleString()} MIST
                      </p>
                    )}
                  </div>
                </>
              ) : (
                /* ── Object mode: type tag + optional exact object ID ── */
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Requested Object Type
                    </label>
                    <input
                      ref={counterTypeRef}
                      type="text"
                      placeholder="0x\u2026::module::Type"
                      value={counterItemType}
                      onChange={(e) => setCounterItemType(e.target.value)}
                      className={`w-full rounded-xl border bg-bg-primary px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 transition ${inputBorderStyle(isCounterTypeValid)}`}
                    />
                    <p className="mt-1 text-xs text-muted">
                      Move type tag of the object you want in return (e.g.
                      0x\u2026::nft::MyNFT)
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Exact Object ID
                      <span className="ml-1.5 text-xs font-normal text-muted">
                        (optional)
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="0x\u2026 (leave blank to accept any)"
                      value={requestedObjectId}
                      onChange={(e) => setRequestedObjectId(e.target.value)}
                      className={`w-full rounded-xl border bg-bg-primary px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 transition ${
                        requestedObjectId
                          ? inputBorderStyle(isObjectIdValid)
                          : 'border-subtle focus:ring-info/30'
                      }`}
                    />
                    {requestedObjectId && !isObjectIdValid && (
                      <p className="mt-1 text-xs text-danger">
                        Enter a valid Sui object ID (0x\u2026, 42+ chars)
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Navigation */}
              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="rounded-xl border border-subtle px-6 py-3 font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isStep1Valid) {
                      if (swapMode === 'coin' && !isAmountValid)
                        shakeElement(amountRef.current);
                      if (swapMode === 'object' && !isCounterTypeValid)
                        shakeElement(counterTypeRef.current);
                      return;
                    }
                    setStep(2);
                  }}
                  className={`rounded-xl gradient-primary px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] cursor-pointer ${
                    !isStep1Valid ? 'opacity-60' : ''
                  }`}
                >
                  Next
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2 — Recipient & Terms (shared) */}
          {step === 2 && (
            <motion.div key="step-2" {...STEP_MOTION} className="space-y-5">
              <h3 className="text-lg font-semibold">Recipient &amp; Terms</h3>

              {/* Recipient address */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Recipient Address
                </label>
                <input
                  ref={recipientRef}
                  type="text"
                  placeholder="0x\u2026"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className={`w-full rounded-xl border px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 transition bg-bg-primary ${addressBorderStyle(recipient, isValidAddress)}`}
                />
                {recipient && !isValidAddress && (
                  <p className="mt-1 text-xs text-danger">
                    Enter a valid Sui address (0x\u2026, 42+ chars)
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Description
                </label>
                <textarea
                  ref={descriptionRef}
                  placeholder="Describe this swap\u2026"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={`w-full rounded-xl border bg-bg-primary px-4 py-2.5 text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 transition resize-none ${inputBorderStyle(isDescriptionValid)}`}
                />
              </div>

              {/* Timeout */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Timeout (hours)
                </label>
                <input
                  ref={timeoutRef}
                  type="number"
                  min={1}
                  max={720}
                  value={timeoutHours}
                  onChange={(e) => setTimeoutHours(Number(e.target.value))}
                  className={`w-32 rounded-xl border bg-bg-primary px-4 py-2.5 text-sm text-text-primary outline-none focus:ring-2 transition ${inputBorderStyle(isTimeoutFieldValid)}`}
                />
                <p className="mt-1 text-xs text-muted">
                  After timeout, the creator can cancel and reclaim the asset.
                </p>
              </div>

              {/* Navigation */}
              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-subtle px-6 py-3 font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isStep2Valid) {
                      if (!isValidAddress) shakeElement(recipientRef.current);
                      if (!description.trim()) shakeElement(descriptionRef.current);
                      if (timeoutHours <= 0) shakeElement(timeoutRef.current);
                      return;
                    }
                    setStep(3);
                  }}
                  className={`rounded-xl gradient-primary px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] cursor-pointer ${
                    !isStep2Valid ? 'opacity-60' : ''
                  }`}
                >
                  Review
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3 — Review & Submit */}
          {step === 3 && selectedAsset && (
            <motion.div key="step-3" {...STEP_MOTION}>
              <h3 className="mb-6 text-lg font-semibold">Review &amp; Submit</h3>

              {/* Visual swap direction banner */}
              <div className="mb-5 flex items-center justify-center gap-3 rounded-xl border border-subtle bg-surface-soft p-4">
                <div className="text-center">
                  <p className="text-xs text-muted">You give</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-text-primary">
                    {shortType(selectedAsset.type)}
                  </p>
                </div>
                <span className="text-xl text-muted">
                  {swapMode === 'coin' ? '\u2192' : '\u21C4'}
                </span>
                <div className="text-center">
                  <p className="text-xs text-muted">You receive</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-text-primary">
                    {swapMode === 'coin'
                      ? `\u2265 ${requestedAmount} ${selectedCoin.symbol}`
                      : shortType(counterItemType)}
                  </p>
                  {swapMode === 'object' && (
                    <p className="text-xs text-muted">
                      {requestedObjectId
                        ? truncateAddress(requestedObjectId)
                        : '(any)'}
                    </p>
                  )}
                </div>
              </div>

              {/* Detail rows */}
              <div className="space-y-3 rounded-xl border border-subtle bg-surface-soft p-5">
                <ReviewRow
                  label="Mode"
                  value={swapMode === 'coin' ? 'Coin Swap' : 'Object Swap'}
                />
                <ReviewRow
                  label="Your Asset"
                  value={shortType(selectedAsset.type)}
                  mono
                />
                <ReviewRow
                  label="Asset ID"
                  value={truncateAddress(selectedAsset.objectId)}
                  mono
                />

                {swapMode === 'coin' ? (
                  <>
                    <ReviewRow
                      label="Coin Type"
                      value={shortType(coinType)}
                      mono
                    />
                    <ReviewRow
                      label="Requested Amount"
                      value={`${requestedAmount} ${selectedCoin.symbol}`}
                    />
                  </>
                ) : (
                  <>
                    <ReviewRow
                      label="Requested Type"
                      value={shortType(counterItemType)}
                      mono
                    />
                    <ReviewRow
                      label="Exact Object"
                      value={
                        requestedObjectId
                          ? truncateAddress(requestedObjectId)
                          : 'Any'
                      }
                      mono={!!requestedObjectId}
                    />
                  </>
                )}

                <ReviewRow
                  label="Recipient"
                  value={truncateAddress(recipient)}
                  mono
                />
                <ReviewRow label="Description" value={description} />
                <ReviewRow label="Timeout" value={`${timeoutHours} hours`} />
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-danger/30 bg-rose-50 p-4 text-sm text-danger">
                  {error.message}
                </div>
              )}

              <div className="mt-6 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={loading}
                  className="rounded-xl border border-subtle px-6 py-3 font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSubmit}
                  className="rounded-xl gradient-primary px-8 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Creating Swap&hellip;
                    </span>
                  ) : (
                    `Create ${swapMode === 'coin' ? 'Coin' : 'Object'} Swap`
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
