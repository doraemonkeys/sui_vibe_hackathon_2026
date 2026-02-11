import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, animate } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import AssetSelector from './AssetSelector';
import { useCreateSwap } from '@/hooks/useSwap';

// ── Constants ──

const SUI_COIN_TYPE = '0x2::coin::Coin<0x2::sui::SUI>';

const STEP_LABELS = ['Select Asset', 'Parameters', 'Review'] as const;

// ── Types ──

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

function shortType(type: string): string {
  if (!type) return 'Unknown';
  if (type.includes('Coin<0x2::sui::SUI>')) return 'SUI Coin';
  const open = type.indexOf('<');
  const base = open === -1 ? type : type.slice(0, open);
  const parts = base.split('::');
  return parts.slice(-2).join('::');
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

function SwapReviewStep({
  selectedAsset,
  effectiveRecipientType,
  recipient,
  description,
  timeoutHours,
  error,
  loading,
  onBack,
  onSubmit,
}: {
  selectedAsset: SelectedAsset;
  effectiveRecipientType: string;
  recipient: string;
  description: string;
  timeoutHours: number;
  error: Error | null;
  loading: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <motion.div key="step-2" {...STEP_MOTION}>
      <h3 className="mb-6 text-lg font-semibold">Review &amp; Submit</h3>

      <div className="space-y-3 rounded-xl border border-subtle bg-surface-soft p-5">
        <ReviewRow label="Your Asset" value={shortType(selectedAsset.type)} mono />
        <ReviewRow label="Asset ID" value={truncateAddress(selectedAsset.objectId)} mono />
        <ReviewRow label="Expected Type" value={shortType(effectiveRecipientType)} mono />
        <ReviewRow label="Recipient" value={truncateAddress(recipient)} mono />
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
          onClick={onBack}
          disabled={loading}
          className="rounded-xl border border-subtle px-6 py-3 font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={onSubmit}
          className="rounded-xl gradient-primary px-8 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Creating Swap…
            </span>
          ) : (
            'Create Swap'
          )}
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Component ──

/**
 * Swap creation form — 3-step wizard.
 * Step 0: Select asset from wallet via AssetSelector
 * Step 1: Swap parameters (expected type, recipient, description, timeout)
 * Step 2: Review & submit
 */
export default function CreateSwapForm() {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const { execute, loading, error } = useCreateSwap();

  // ── Form state ──
  const [step, setStep] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset | null>(
    null,
  );
  const [recipientAssetType, setRecipientAssetType] = useState(SUI_COIN_TYPE);
  const [useCustomType, setUseCustomType] = useState(false);
  const [customType, setCustomType] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [timeoutHours, setTimeoutHours] = useState(24);

  const effectiveRecipientType = useCustomType ? customType : recipientAssetType;

  // Input refs for shake animation
  const recipientRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const timeoutRef = useRef<HTMLInputElement>(null);
  const customTypeRef = useRef<HTMLInputElement>(null);

  function shakeElement(el: HTMLElement | null) {
    if (el) animate(el, { x: [0, -8, 8, -6, 6, -3, 3, 0] }, { duration: 0.3 });
  }

  // Valid-state detection for green border transitions
  const isDescriptionValid = description.trim().length > 0;
  const isTimeoutFieldValid = timeoutHours > 0;

  // ── Validation ──
  const isStep0Valid = selectedAsset !== null;
  const isValidAddress =
    recipient.startsWith('0x') && recipient.length >= 42;
  const isStep1Valid =
    isValidAddress &&
    effectiveRecipientType.length > 0 &&
    description.trim().length > 0 &&
    timeoutHours > 0;

  // ── Submit ──
  const handleSubmit = async () => {
    if (!selectedAsset || !account) return;
    try {
      await execute({
        creatorAssetType: selectedAsset.type,
        recipientAssetType: effectiveRecipientType,
        recipient,
        description: description.trim(),
        timeoutMs: timeoutHours * 3_600_000,
        assetObjectId: selectedAsset.objectId,
      });
      navigate('/swaps');
    } catch {
      // Error state managed by the hook
    }
  };

  if (!account) return <SwapWalletGuard />;

  return (
    <div className="rounded-2xl border border-subtle bg-surface overflow-hidden">
      {/* Top accent band */}
      <div className="h-1 gradient-swap" />

      <div className="p-6 sm:p-8">
        <SwapStepIndicator step={step} onStepClick={setStep} />

        {/* ── Step content ── */}
        <AnimatePresence mode="wait">
          {/* Step 0 — Select Asset */}
          {step === 0 && (
            <motion.div key="step-0" {...STEP_MOTION}>
              <h3 className="mb-4 text-lg font-semibold">Select Your Asset</h3>
              <AssetSelector
                onSelect={(asset) => setSelectedAsset(asset)}
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

          {/* Step 1 — Parameters */}
          {step === 1 && (
            <motion.div key="step-1" {...STEP_MOTION} className="space-y-5">
              <h3 className="text-lg font-semibold">Swap Parameters</h3>

              {/* Expected recipient asset type */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Expected Recipient Asset Type
                </label>
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUseCustomType(false);
                      setRecipientAssetType(SUI_COIN_TYPE);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      !useCustomType
                        ? 'gradient-swap text-white'
                        : 'bg-surface-soft text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    SUI Coin
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseCustomType(true)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      useCustomType
                        ? 'gradient-swap text-white'
                        : 'bg-surface-soft text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Custom Type
                  </button>
                </div>
                {useCustomType && (
                  <input
                    ref={customTypeRef}
                    type="text"
                    placeholder="0x\u2026::module::Type"
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value)}
                    className={`w-full rounded-xl border bg-bg-primary px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 transition ${
                      customType.length > 0
                        ? 'border-success focus:ring-success/30'
                        : 'border-subtle focus:ring-info/30'
                    }`}
                  />
                )}
              </div>

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
                  className={`w-full rounded-xl border bg-bg-primary px-4 py-2.5 text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 transition resize-none ${
                    isDescriptionValid
                      ? 'border-success focus:ring-success/30'
                      : 'border-subtle focus:ring-info/30'
                  }`}
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
                  className={`w-32 rounded-xl border bg-bg-primary px-4 py-2.5 text-sm text-text-primary outline-none focus:ring-2 transition ${
                    isTimeoutFieldValid
                      ? 'border-success focus:ring-success/30'
                      : 'border-subtle focus:ring-info/30'
                  }`}
                />
                <p className="mt-1 text-xs text-muted">
                  After timeout, the creator can cancel and reclaim the asset.
                </p>
              </div>

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
                      if (!isValidAddress) shakeElement(recipientRef.current);
                      if (!description.trim()) shakeElement(descriptionRef.current);
                      if (timeoutHours <= 0) shakeElement(timeoutRef.current);
                      if (useCustomType && !customType) shakeElement(customTypeRef.current);
                      return;
                    }
                    setStep(2);
                  }}
                  className={`rounded-xl gradient-primary px-6 py-3 font-semibold text-white transition hover:translate-y-[-1px] hover:shadow-md active:scale-[0.98] cursor-pointer ${!isStep1Valid ? 'opacity-60' : ''}`}
                >
                  Review
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2 — Review & Submit */}
          {step === 2 && selectedAsset && (
            <SwapReviewStep
              selectedAsset={selectedAsset}
              effectiveRecipientType={effectiveRecipientType}
              recipient={recipient}
              description={description}
              timeoutHours={timeoutHours}
              error={error}
              loading={loading}
              onBack={() => setStep(1)}
              onSubmit={handleSubmit}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Sub-component ──

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
