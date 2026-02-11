import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import EscrowDetail from '@/components/EscrowDetail';

/** Escrow detail page — reads `:id` from URL and delegates to the EscrowDetail component. */
export default function EscrowDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mx-auto max-w-4xl px-4 pt-24 pb-16 sm:px-6 text-center"
      >
        <h2 className="text-lg font-semibold text-text-primary">
          Escrow not found
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          No escrow ID was provided in the URL.
        </p>
        <Link
          to="/escrows"
          className="mt-4 inline-block text-sm font-semibold text-info hover:underline"
        >
          Back to My Escrows
        </Link>
      </motion.main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pt-24 pb-16 sm:px-6">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-text-secondary">
        <Link to="/escrows" className="hover:text-text-primary transition-colors">
          My Escrows
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-text-primary font-medium">Detail</span>
      </nav>

      <EscrowDetail id={id} />
    </main>
  );
}
