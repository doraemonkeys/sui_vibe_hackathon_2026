import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCurrentClient } from '@mysten/dapp-kit-react';
import SwapDetail from '@/components/SwapDetail';

type SwapKind = 'coin' | 'object';

/**
 * Detect whether an on-chain object is a Coin-Swap or Object-Swap by
 * inspecting its Move type string.  `::swap::Swap<` → coin,
 * `::object_swap::ObjectSwap<` → object.
 */
function detectKindFromType(typeString: string): SwapKind | null {
  if (typeString.includes('::swap::Swap<')) return 'coin';
  if (typeString.includes('::object_swap::ObjectSwap<')) return 'object';
  return null;
}

/** Swap detail page — reads :id from URL params, wraps SwapDetail component */
export default function SwapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const client = useCurrentClient();

  // Prefer route state carried by SwapCard navigation
  const routeKind = (location.state as { kind?: SwapKind } | null)?.kind ?? null;

  const [detectedKind, setDetectedKind] = useState<SwapKind | null>(routeKind);
  const [detecting, setDetecting] = useState(!routeKind);

  // Fallback: when route state is absent (direct URL / page refresh),
  // fetch the object's type from chain to determine the swap module.
  useEffect(() => {
    if (routeKind || !id) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await client.getObject({ objectId: id });
        if (cancelled) return;
        const typeString = res.object?.type ?? '';
        setDetectedKind(detectKindFromType(typeString) ?? 'coin');
      } catch {
        // Object may be destroyed — default to 'coin' so SwapDetail can
        // attempt event-based reconstruction, which is its existing fallback.
        if (!cancelled) setDetectedKind('coin');
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [routeKind, id, client]);

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

  if (detecting) {
    return (
      <main className="mx-auto max-w-4xl px-4 pt-24 pb-16 sm:px-6">
        <div className="flex items-center justify-center py-24">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-info border-t-transparent" />
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
      <SwapDetail swapId={id} swapKind={detectedKind ?? 'coin'} />
    </motion.main>
  );
}
