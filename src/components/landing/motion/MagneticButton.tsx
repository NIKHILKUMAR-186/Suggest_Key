import React, { type ButtonHTMLAttributes } from 'react';
import { motion, type HTMLMotionProps, useMotionValue, useSpring } from 'motion/react';
import { landingMotion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

type MagneticButtonProps = Omit<
  HTMLMotionProps<'button'>,
  'onPointerLeave' | 'onPointerMove' | 'style' | 'transition' | 'whileTap'
> & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onPointerLeave' | 'onPointerMove'>;

export function MagneticButton({
  children,
  className,
  onPointerLeave,
  onPointerMove,
  ...props
}: MagneticButtonProps) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, landingMotion.spring);
  const springY = useSpring(y, landingMotion.spring);

  const handlePointerMove: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerMove?.(event);
    if (reduceMotion || event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - bounds.left - bounds.width / 2) * 0.12);
    y.set((event.clientY - bounds.top - bounds.height / 2) * 0.12);
  };

  const handlePointerLeave: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerLeave?.(event);
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      {...props}
      className={className}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={reduceMotion ? undefined : { x: springX, y: springY }}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      transition={{ duration: landingMotion.duration.feedback }}
    >
      {children}
    </motion.button>
  );
}
