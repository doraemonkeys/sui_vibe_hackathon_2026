import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Types ──

type TxStage = 'pending' | 'confirmed' | 'settled';

const STAGES: TxStage[] = ['pending', 'confirmed', 'settled'];

const STAGE_LABELS: Record<TxStage, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  settled: 'Settled',
};

const STAGE_WIDTH: Record<TxStage, string> = {
  pending: '33%',
  confirmed: '66%',
  settled: '100%',
};

function stageCircleStyle(isDone: boolean, isActive: boolean): string {
  if (isDone) return 'bg-success text-white';
  if (isActive) return 'gradient-primary text-white';
  return 'bg-surface-soft text-muted';
}

function stageTextStyle(isDone: boolean, isActive: boolean): string {
  if (isDone) return 'text-success';
  if (isActive) return 'text-text-primary';
  return 'text-muted';
}

// ── Component ──

interface TransactionToastProps {
  visible: boolean;
  onDone: () => void;
}

/**
 * Fixed-position bottom-right toast showing 3-stage transaction progress.
 * Stages auto-advance on a timer and the toast auto-dismisses via onDone.
 */
export default function TransactionToast({ visible, onDone }: TransactionToastProps) {
  const [stage, setStage] = useState<TxStage>('pending');

  useEffect(() => {
    if (!visible) {
      // Reset asynchronously to avoid synchronous setState in effect body
      const reset = setTimeout(() => setStage('pending'), 0);
      return () => clearTimeout(reset);
    }
    // Auto-progress: pending → confirmed → settled → dismiss
    const t1 = setTimeout(() => setStage('confirmed'), 1200);
    const t2 = setTimeout(() => setStage('settled'), 2400);
    const t3 = setTimeout(onDone, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [visible, onDone]);

  const currentIdx = STAGES.indexOf(stage);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-6 right-6 z-50 w-72 rounded-2xl border border-subtle bg-surface p-4 shadow-xl"
        >
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-text-secondary">
            Transaction Progress
          </p>

          <div className="space-y-2.5">
            {STAGES.map((s, i) => {
              const isDone = i < currentIdx;
              const isActive = i === currentIdx;
              return (
                <div key={s} className="flex items-center gap-3">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-300 ${stageCircleStyle(isDone, isActive)}`}
                  >
                    {isDone ? (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={`text-sm font-medium transition-colors duration-300 ${stageTextStyle(isDone, isActive)}`}
                  >
                    {STAGE_LABELS[s]}
                  </span>
                  {isActive && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="ml-auto text-[11px] text-info"
                    >
                      Processing…
                    </motion.span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1 rounded-full bg-surface-soft overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #5B8CFF, #16A34A)' }}
              initial={{ width: '0%' }}
              animate={{ width: STAGE_WIDTH[stage] }}
              transition={{ duration: 0.5, ease: 'easeOut' as const }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
