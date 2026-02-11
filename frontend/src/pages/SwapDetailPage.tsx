import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import SwapDetail from '@/components/SwapDetail';

/** Swap detail page — reads :id from URL params, wraps SwapDetail component */
export default function SwapDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <main className="mx-auto max-w-4xl px-4 pt-24 pb-16 sm:px-6">
        <div className="rounded-2xl border border-subtle bg-surface-soft p-12 text-center">
          <p className="text-lg font-semibold text-text-primary">
            Missing swap ID
          </p>
          <p className="mt-1 text-sm text-muted">
            No swap ID was provided in the URL.
          </p>
        </div>
      </main>
    );
  }

  return (
    <motion.main
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="mx-auto max-w-4xl px-4 pt-24 pb-16 sm:px-6"
    >
      <SwapDetail swapId={id} />
    </motion.main>
  );
}
