import { motion } from 'framer-motion';
import CreateSwapForm from '@/components/CreateSwapForm';

/** Create Swap page — wraps the multi-step form with a page title */
export default function CreateSwap() {
  return (
    <motion.main
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="mx-auto max-w-3xl px-4 pt-24 pb-16 sm:px-6"
    >
      <h1 className="mb-8 font-display text-3xl font-bold gradient-text sm:text-4xl">
        Create Swap
      </h1>
      <CreateSwapForm />
    </motion.main>
  );
}
