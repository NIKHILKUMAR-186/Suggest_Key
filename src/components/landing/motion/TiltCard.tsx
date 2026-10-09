import React from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { landingMotion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

interface TiltCardProps {
  as?: 'article' | 'button' | 'div' | 'section';
  children: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

export function TiltCard({
  as = 'div',
  children,
  className,
  onClick,
}: TiltCardProps) {
  const reduceMotion = useReducedMotion();
  const rotateX = useSpring(useMotionValue(0), landingMotion.spring);
  const rotateY = useSpring(useMotionValue(0), landingMotion.spring);
  const MotionTag = motion[as];

  const handlePointerMove: React.PointerEventHandler<HTMLElement> = (event) => {
    if (reduceMotion || event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    rotateX.set(y * -3);
    rotateY.set(x * 3);
  };

  const reset = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <MotionTag
      className={className}
      onClick={onClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      style={
        reduceMotion
          ? undefined
          : {
              rotateX,
              rotateY,
              transformPerspective: 900,
              transformStyle: 'preserve-3d',
            }
      }
    >
      {children}
    </MotionTag>
  );
}
