'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useAnimate } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Six boxes for the code from the phone. One real input under them (paste, the phone's own
 * "fill in the code", the keyboard with numbers only): the boxes only show what was typed.
 * `shake` changes → the boxes shake (wrong code).
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  name,
  disabled,
  shake = 0,
  autoFocus,
  label = 'Codice di 6 cifre',
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  name?: string;
  disabled?: boolean;
  shake?: number;
  autoFocus?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  // focus at the start and again after a check (a disabled input loses the cursor): the next code can be typed at once
  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);
  useEffect(() => {
    if (shake && scope.current) void animate(scope.current, { x: [0, -12, 10, -7, 4, 0] }, { duration: 0.45 });
  }, [shake, animate, scope]);
  return (
    <div ref={scope} className="relative" onClick={() => input.current?.focus()}>
      <input
        ref={input}
        name={name}
        value={value}
        data-autofocus
        aria-label={label}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(v);
          if (v.length === 6) onComplete?.(v);
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => {
          const ch = value[i];
          const active = focused && !disabled && (i === value.length || (i === 5 && value.length === 6));
          return (
            <div
              key={i}
              className={cn(
                'flex h-14 items-center justify-center rounded-2xl border bg-white text-2xl font-semibold tabular-nums text-navy transition-[border-color,box-shadow] duration-200',
                active ? 'border-navy shadow-[0_0_0_4px_rgba(16,40,61,0.08)]' : ch ? 'border-navy/35' : 'border-line',
                disabled && 'opacity-60',
              )}
            >
              {ch ? (
                <motion.span initial={{ scale: 0.4, opacity: 0, y: 6 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 26 }}>
                  {ch}
                </motion.span>
              ) : active ? (
                <span className="h-6 w-[2px] animate-pulse rounded-full bg-navy" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
