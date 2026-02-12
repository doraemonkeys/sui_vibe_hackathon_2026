import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

/* ━━ Animation Variants ━━ */

const FADE_UP = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
} as const;

const STAGGER_CONTAINER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
} as const;

/* ━━ Static Data ━━ */

const PRIMITIVES = [
  {
    icon: '🔒',
    title: 'ESCROW',
    description:
      'Need arbitration? Delegate to a trusted third party who settles disputes with a single ruling.',
    link: '/create',
    gradientClass: 'gradient-escrow',
  },
  {
    icon: '⚡',
    title: 'SWAP',
    description:
      'Atomic peer-to-peer swaps — NFT-for-Coin and NFT-for-NFT. Zero trust, zero counterparty risk.',
    link: '/swap/create',
    gradientClass: 'gradient-swap',
  },
] as const;

const STEPS = [
  {
    number: '①',
    title: 'Deposit',
    description: 'Lock your assets into a secure on-chain contract.',
  },
  {
    number: '②',
    title: 'Verify',
    description: 'Both parties review terms and confirm the deal.',
  },
  {
    number: '③',
    title: 'Settle',
    description: 'Assets transfer atomically — no middleman needed.',
  },
] as const;

/* ━━ Subtle Background Blob ━━ */

/** Gently drifting gradient blob — purely decorative, GPU-composited. */
function FloatingShape({
  className,
  duration,
  yRange,
  xRange,
}: {
  className: string;
  duration: number;
  yRange: [number, number, number];
  xRange: [number, number, number];
}) {
  return (
    <motion.div
      className={className}
      animate={{ y: yRange, x: xRange }}
      transition={{
        duration,
        repeat: Infinity,
        repeatType: 'reverse',
        ease: 'easeInOut',
      }}
      aria-hidden
    />
  );
}

/* ━━ Landing Page ━━ */

/** Landing page — hero + dual-primitive intro (Escrow & Swap) + How It Works */
export default function Landing() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="relative min-h-screen overflow-hidden"
    >
      {/* ── Animated Background ── */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <FloatingShape
          className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-[#5b8cff]/10 blur-3xl"
          duration={10}
          yRange={[0, -30, 0]}
          xRange={[0, 20, 0]}
        />
        <FloatingShape
          className="absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-[#ff6fb5]/10 blur-3xl"
          duration={12}
          yRange={[0, 25, 0]}
          xRange={[0, -15, 0]}
        />
        <FloatingShape
          className="absolute bottom-16 left-1/4 h-64 w-64 rounded-full bg-[#8a6bff]/[0.08] blur-3xl"
          duration={14}
          yRange={[0, -20, 0]}
          xRange={[0, 18, 0]}
        />
      </div>

      {/* ── Hero Section ── */}
      <section className="flex flex-col items-center justify-center px-6 pt-32 pb-20 text-center lg:pt-40 lg:pb-28">
        <motion.h1
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="font-display text-5xl font-bold leading-tight gradient-text sm:text-6xl lg:text-7xl"
        >
          TRUSTLESS DEALS
          <br />
          ON SUI
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          className="mt-6 max-w-md text-lg text-text-secondary"
        >
          Two primitives. Zero trust required.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="mt-8"
        >
          <Link
            to="/create"
            className="inline-block rounded-xl gradient-primary px-8 py-3.5 font-semibold text-white shadow-lg shadow-indigo-200/50 transition hover:shadow-xl"
          >
            Start Trading ↗
          </Link>
        </motion.div>
      </section>

      {/* ── Dual Primitive Cards ── */}
      <motion.section
        variants={STAGGER_CONTAINER}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        className="mx-auto grid max-w-4xl gap-6 px-6 pb-24 lg:grid-cols-2"
      >
        {PRIMITIVES.map((p) => (
          <motion.div
            key={p.title}
            variants={FADE_UP}
            className="group relative overflow-hidden rounded-2xl border border-subtle bg-surface p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
          >
            {/* Gradient color band along the top edge */}
            <div
              className={`absolute inset-x-0 top-0 h-1 ${p.gradientClass}`}
            />

            <span className="text-3xl">{p.icon}</span>
            <h2 className="mt-4 font-display text-xl font-bold tracking-wide text-text-primary">
              {p.title}
            </h2>
            <p className="mt-2 leading-relaxed text-text-secondary">
              {p.description}
            </p>

            <motion.div
              whileHover={{ x: 4 }}
              transition={{ type: 'spring', stiffness: 300 }}
              className="mt-5 inline-block"
            >
              <Link
                to={p.link}
                className="inline-flex items-center gap-1 font-semibold text-text-primary transition-colors hover:text-info"
              >
                Create <span aria-hidden>→</span>
              </Link>
            </motion.div>
          </motion.div>
        ))}
      </motion.section>

      {/* ── How It Works ── */}
      <motion.section
        variants={STAGGER_CONTAINER}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        className="mx-auto max-w-4xl px-6 pb-32"
      >
        <motion.h2
          variants={FADE_UP}
          className="text-center font-display text-2xl font-bold tracking-widest text-text-primary"
        >
          HOW IT WORKS
        </motion.h2>

        <div className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-0">
          {/* Connecting line between step circles — visible on desktop only */}
          <div
            className="pointer-events-none absolute top-10 left-[16.67%] right-[16.67%] hidden h-px bg-subtle md:block"
            aria-hidden
          />

          {STEPS.map((step) => (
            <motion.div
              key={step.title}
              variants={FADE_UP}
              className="relative flex flex-col items-center text-center"
            >
              <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full border border-subtle bg-surface shadow-md">
                <span className="font-display text-2xl font-bold gradient-text">
                  {step.number}
                </span>
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-text-primary">
                {step.title}
              </h3>
              <p className="mt-1.5 max-w-56 text-sm text-text-secondary">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </motion.div>
  );
}
