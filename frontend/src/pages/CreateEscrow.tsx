import { motion } from 'framer-motion';
import CreateEscrowForm from '@/components/CreateEscrowForm';

/** Create Escrow page — hero title + multi-step form. */
export default function CreateEscrow() {
  return (
    <motion.main
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="mx-auto max-w-2xl px-4 pt-24 pb-16 sm:px-6"
    >
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-bold text-text-primary sm:text-4xl">
          Create Escrow
        </h1>
        <p className="mt-2 text-text-secondary">
          Lock SUI in a trustless escrow with arbiter protection.
        </p>
      </div>

      <CreateEscrowForm />
    </motion.main>
  );
}
