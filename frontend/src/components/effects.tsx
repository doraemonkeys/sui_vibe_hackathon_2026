/* eslint-disable sonarjs/pseudo-random -- visual decoration effects with no security implications */
import { useState, useEffect, useRef } from 'react';
import { motion, animate } from 'framer-motion';

// ── Confetti Effect ─────────────────────────────────────────────────────────────

/** Confetti particles scattered from viewport center on success. */
export function ConfettiEffect({ onComplete }: { onComplete?: () => void }) {
  const [particles] = useState(() =>
    Array.from({ length: 30 }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 120 + Math.random() * 280;
      return {
        id: i,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance - Math.random() * 80,
        rotate: Math.random() * 720 - 360,
        color: ['#5B8CFF', '#8A6BFF', '#FF6FB5', '#22C7A9', '#FFB347', '#16A34A'][i % 6],
        size: 5 + Math.random() * 7,
        delay: Math.random() * 0.3,
        isCircle: Math.random() > 0.5,
      };
    }),
  );

  useEffect(() => {
    const timer = setTimeout(() => onComplete?.(), 2200);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: '-50%', y: '-50%', left: '50%', top: '45%', opacity: 1, scale: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.2, rotate: p.rotate }}
          transition={{ duration: 2, delay: p.delay, ease: 'easeOut' as const }}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.size,
            borderRadius: p.isCircle ? '50%' : '2px',
            backgroundColor: p.color,
          }}
        />
      ))}
    </div>
  );
}

// ── Particle Effect ─────────────────────────────────────────────────────────────

/** Particle scatter around an element on action completion. */
export function ParticleEffect({ onComplete }: { onComplete?: () => void }) {
  const [particles] = useState(() =>
    Array.from({ length: 10 }, (_, i) => {
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
      const distance = 40 + Math.random() * 60;
      return {
        id: i,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        color: ['#22C7A9', '#4DA4FF', '#5B8CFF', '#8A6BFF', '#16A34A'][i % 5],
        size: 4 + Math.random() * 5,
      };
    }),
  );

  useEffect(() => {
    const timer = setTimeout(() => onComplete?.(), 1200);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          animate={{ opacity: 0, scale: 0, x: p.x, y: p.y }}
          transition={{ duration: 1, ease: 'easeOut' as const }}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            backgroundColor: p.color,
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  );
}

// ── Animated Number ─────────────────────────────────────────────────────────────

/** Counting-up animation on mount, smooth transitions on subsequent value changes. */
export function AnimatedNumber({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const from = isFirstRender.current ? 0 : displayRef.current;
    const duration = isFirstRender.current ? 1 : 0.3;
    isFirstRender.current = false;

    const controls = animate(from, value, {
      duration,
      ease: 'easeOut' as const,
      onUpdate: (v) => {
        displayRef.current = v;
        setDisplay(v);
      },
    });
    return () => controls.stop();
  }, [value]);

  return <>{display.toFixed(decimals)}</>;
}
