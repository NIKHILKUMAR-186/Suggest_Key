import React, { useRef } from 'react';
import { useInView } from 'motion/react';
import { useReducedMotion } from './useReducedMotion';

export interface MarqueeProps {
  items: string[];
}

export function Marquee({ items }: MarqueeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.1 });
  const reduceMotion = useReducedMotion();

  return (
    <div
      ref={ref}
      className="sk-motion-marquee"
      data-running={!reduceMotion && inView ? 'true' : 'false'}
      aria-label={items.join(', ')}
      role="group"
    >
      <div className="sk-motion-marquee__track">
        {[0, 1].map((copy) => (
          <div
            className="sk-motion-marquee__group"
            aria-hidden={copy === 1 || reduceMotion}
            key={copy}
          >
            {items.map((item) => (
              <span className="sk-motion-marquee__item" key={`${copy}-${item}`}>
                <span className="sk-motion-marquee__dot" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Marquee;
