'use client';
import { motion } from 'motion/react';

/**
 * Enter animation for every route change (exit is handled by the transition veil).
 * Opacity only: a transform here would break GSAP pinning and sticky layouts below.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, ease: [0.22, 0.61, 0.12, 1] }}>
      {children}
    </motion.div>
  );
}
