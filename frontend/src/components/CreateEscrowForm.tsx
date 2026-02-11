import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, animate } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { useCreateEscrow } from '@/hooks/useEscrow';

// ── Constants ───────────────────────────────────────────────────────────────────

const MIST_PER_SUI = 1_000_000_000;
const STEP_LABELS = ['Asset', 'Params', 'Review'] as const;

/** Sui addresses are 0x-prefixed hex strings, 3-66 characters total. */
function isValidSuiAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(addr);
}

// ── Step transition animation ───────────────────────────────────────────────────

const STEP_VARIANTS = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 40 : -40,
  }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -40 : 40,
  }),
};

// ── Style helpers ────────────────────────────────────────────────────────────────

function stepCircleStyle(completed: boolean, active: boolean): string {
  if (completed) return 'bg-emerald-500 text-white';
  if (active) return 'gradient-primary text-white shadow-md';
  return 'border border-subtle bg-surface-soft text-muted';
}

function inputBorderStyle(hasError: boolean, isValid: boolean): string {
  if (hasError) return INPUT_ERR;
  if (isValid) return INPUT_VALID;
  return INPUT_OK;
}

// ── Validation ───────────────────────────────────────────────────────────────────

function validateAssetFields(amount: string, description: string): Record<string, string> {
  const errs: Record<string, string> = {};
  const parsed = parseFloat(amount);
  if (!amount || isNaN(parsed) || parsed <= 0) {
    errs.amount = 'Amount must be greater than 0';
  }
  if (!description.trim()) {
    errs.description = 'Description is required';
  }
  return errs;
}

function validateParamFields(
  recipient: string, arbiter: string, timeoutHours: string,
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!isValidSuiAddress(recipient)) errs.recipient = 'Enter a valid Sui address (0x...)';
  if (!isValidSuiAddress(arbiter)) errs.arbiter = 'Enter a valid Sui address (0x...)';
  if (recipient && arbiter && recipient === arbiter) {
    errs.arbiter = 'Arbiter must be a different address than recipient';
  }
  const h = parseFloat(timeoutHours);
  if (!timeoutHours || isNaN(h) || h <= 0) errs.timeoutHours = 'Timeout must be a positive number';
  return errs;
}

// ── Progress Bar ────────────────────────────────────────────────────────────────

function ProgressBar({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const completed = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 ${stepCircleStyle(completed, active)}`}
              >
                {completed ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-semibold ${active ? 'text-text-primary' : 'text-muted'}`}
              >
                {label}
              </span>
            </div>
            {/* Connecting line */}
            {i < STEP_LABELS.length - 1 && (
              <div
                className={`mx-3 h-0.5 w-16 rounded-full transition-colors duration-300 ${
                  i < current ? 'gradient-primary' : 'bg-subtle'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Input helpers ───────────────────────────────────────────────────────────────

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-1.5 text-sm text-danger"
    >
      {message}
    </motion.p>
  );
}

const INPUT_BASE =
  'w-full rounded-xl border bg-surface px-4 py-3 text-text-primary placeholder:text-muted outline-none transition-colors focus:ring-2 focus:ring-info/30';
const INPUT_OK = 'border-subtle focus:border-info';
const INPUT_ERR = 'border-danger focus:border-danger';
const INPUT_VALID = 'border-success focus:border-success';

// ── Wallet guard & Success state ─────────────────────────────────────────────────

function WalletGuard() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-subtle bg-surface p-12 text-center">
      <div className="text-4xl">🔒</div>
      <h3 className="text-lg font-semibold text-text-primary">Wallet Required</h3>
      <p className="text-sm text-text-secondary">
        Connect your wallet to create an escrow.
      </p>
    </div>
  );
}

function SuccessScreen() {
  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="flex flex-col items-center gap-4 rounded-2xl border border-subtle bg-surface p-12 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
        <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-text-primary">Escrow Created!</h3>
      <p className="text-sm text-text-secondary">Redirecting to your escrows...</p>
    </motion.div>
  );
}

// ── Step Navigation ─────────────────────────────────────────────────────────────

function StepNav({
  step,
  goBack,
  goNext,
  onSubmit,
  loading,
}: {
  step: number;
  goBack: () => void;
  goNext: () => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between">
      {step > 0 ? (
        <button
          type="button"
          onClick={goBack}
          className="rounded-xl border border-subtle px-5 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer"
        >
          Back
        </button>
      ) : (
        <div />
      )}

      {step < 2 ? (
        <motion.button
          type="button"
          onClick={goNext}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="gradient-primary rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-shadow cursor-pointer"
        >
          Next
        </motion.button>
      ) : (
        <motion.button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          whileHover={loading ? undefined : { scale: 1.02 }}
          whileTap={loading ? undefined : { scale: 0.98 }}
          className="gradient-primary rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-shadow disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Processing...
            </span>
          ) : (
            'Create Escrow'
          )}
        </motion.button>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

/** Multi-step escrow creation form with inline validation and progress bar. */
export default function CreateEscrowForm() {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const { execute, loading, error: txError } = useCreateEscrow();

  // Step navigation
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  // Form fields
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [recipient, setRecipient] = useState('');
  const [arbiter, setArbiter] = useState('');
  const [timeoutHours, setTimeoutHours] = useState('24');

  // Validation
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  // Input refs for shake animation
  const amountRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const arbiterRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<HTMLInputElement>(null);

  // Valid-state detection for green border transition
  const isAmountValid = amount !== '' && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;
  const isDescriptionValid = description.trim().length > 0;
  const isRecipientValid = isValidSuiAddress(recipient);
  const isArbiterValid = isValidSuiAddress(arbiter);
  const isTimeoutValid = timeoutHours !== '' && !isNaN(parseFloat(timeoutHours)) && parseFloat(timeoutHours) > 0;

  function shakeElement(el: HTMLElement | null) {
    if (el) animate(el, { x: [0, -8, 8, -6, 6, -3, 3, 0] }, { duration: 0.3 });
  }

  function validateStep(s: number): boolean {
    const errs = s === 0
      ? validateAssetFields(amount, description)
      : validateParamFields(recipient, arbiter, timeoutHours);

    if (errs.amount) shakeElement(amountRef.current);
    if (errs.description) shakeElement(descriptionRef.current);
    if (errs.recipient) shakeElement(recipientRef.current);
    if (errs.arbiter) shakeElement(arbiterRef.current);
    if (errs.timeoutHours) shakeElement(timeoutRef.current);

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    setDirection(1);
    setStep((s) => s + 1);
  }

  function goBack() {
    setDirection(-1);
    setStep((s) => s - 1);
    setErrors({});
  }

  async function handleSubmit() {
    if (!account) return;
    try {
      const amountInMist = BigInt(Math.round(parseFloat(amount) * MIST_PER_SUI));
      const timeoutMs = BigInt(Math.round(parseFloat(timeoutHours) * 3_600_000));
      await execute({ amountInMist, recipient, arbiter, description: description.trim(), timeoutMs });
      setSuccess(true);
      globalThis.setTimeout(() => navigate('/escrows'), 1500);
    } catch {
      // Error state managed by hook
    }
  }

  if (!account) return <WalletGuard />;
  if (success) return <SuccessScreen />;

  return (
    <div className="rounded-2xl border border-subtle bg-surface p-6 sm:p-8">
      <ProgressBar current={step} />

      <AnimatePresence mode="wait" custom={direction}>
        {/* ── Step 0: Asset ── */}
        {step === 0 && (
          <motion.div
            key="asset"
            custom={direction}
            variants={STEP_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
            className="space-y-5"
          >
            <div>
              <label htmlFor="amount" className="mb-1.5 block text-sm font-semibold text-text-primary">
                Amount (SUI)
              </label>
              <input
                ref={amountRef}
                id="amount"
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 1.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${INPUT_BASE} ${inputBorderStyle(!!errors.amount, isAmountValid)}`}
              />
              <FieldError message={errors.amount} />
            </div>

            <div>
              <label htmlFor="description" className="mb-1.5 block text-sm font-semibold text-text-primary">
                Description
              </label>
              <textarea
                ref={descriptionRef}
                id="description"
                rows={3}
                placeholder="Describe the purpose of this escrow..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`${INPUT_BASE} resize-none ${inputBorderStyle(!!errors.description, isDescriptionValid)}`}
              />
              <FieldError message={errors.description} />
            </div>
          </motion.div>
        )}

        {/* ── Step 1: Params ── */}
        {step === 1 && (
          <motion.div
            key="params"
            custom={direction}
            variants={STEP_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
            className="space-y-5"
          >
            <div>
              <label htmlFor="recipient" className="mb-1.5 block text-sm font-semibold text-text-primary">
                Recipient Address
              </label>
              <input
                ref={recipientRef}
                id="recipient"
                type="text"
                placeholder="0x..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className={`${INPUT_BASE} font-mono text-sm ${inputBorderStyle(!!errors.recipient, isRecipientValid)}`}
              />
              <FieldError message={errors.recipient} />
            </div>

            <div>
              <label htmlFor="arbiter" className="mb-1.5 block text-sm font-semibold text-text-primary">
                Arbiter Address
              </label>
              <input
                ref={arbiterRef}
                id="arbiter"
                type="text"
                placeholder="0x..."
                value={arbiter}
                onChange={(e) => setArbiter(e.target.value)}
                className={`${INPUT_BASE} font-mono text-sm ${inputBorderStyle(!!errors.arbiter, isArbiterValid)}`}
              />
              <FieldError message={errors.arbiter} />
              <p className="mt-1 text-xs text-muted">
                The arbiter can resolve disputes between creator and recipient.
              </p>
            </div>

            <div>
              <label htmlFor="timeout" className="mb-1.5 block text-sm font-semibold text-text-primary">
                Timeout (hours)
              </label>
              <input
                ref={timeoutRef}
                id="timeout"
                type="number"
                min="1"
                step="1"
                placeholder="24"
                value={timeoutHours}
                onChange={(e) => setTimeoutHours(e.target.value)}
                className={`${INPUT_BASE} ${inputBorderStyle(!!errors.timeoutHours, isTimeoutValid)}`}
              />
              <FieldError message={errors.timeoutHours} />
              <p className="mt-1 text-xs text-muted">
                After this period, the creator can reclaim escrowed assets if not confirmed.
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Step 2: Review ── */}
        {step === 2 && (
          <motion.div
            key="review"
            custom={direction}
            variants={STEP_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
            className="space-y-4"
          >
            <h3 className="text-base font-semibold text-text-primary">Review &amp; Confirm</h3>
            <div className="space-y-3 rounded-xl border border-subtle bg-surface-soft p-5 text-sm">
              <ReviewRow label="Amount" value={`${amount} SUI`} />
              <ReviewRow label="Description" value={description} />
              <ReviewRow label="Recipient" value={recipient} mono />
              <ReviewRow label="Arbiter" value={arbiter} mono />
              <ReviewRow label="Timeout" value={`${timeoutHours} hour${parseFloat(timeoutHours) !== 1 ? 's' : ''}`} />
            </div>

            {txError && (
              <div className="rounded-lg border border-danger/30 bg-rose-50 px-4 py-3 text-sm text-danger">
                {txError.message}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Navigation Buttons ── */}
      <StepNav step={step} goBack={goBack} goNext={goNext} onSubmit={handleSubmit} loading={loading} />
    </div>
  );
}

// ── Review Row ──────────────────────────────────────────────────────────────────

function ReviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-text-secondary">{label}</span>
      <span
        className={`font-medium text-text-primary break-all ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
