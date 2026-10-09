import React, { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { landingMotion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

interface SplitTextProps {
  className?: string;
  mode?: 'line' | 'words';
  delay?: number;
  playOnMount?: boolean;
  scrub?: boolean;
  text: string;
}

function ScrubWord({
  index,
  progress,
  text,
  total,
}: {
  index: number;
  progress: MotionValue<number>;
  text: string;
  total: number;
}) {
  const opacity = useTransform(
    progress,
    [index / total, (index + 1) / total],
    [0.84, 1],
  );

  return (
    <motion.span className="sk-motion-word" style={{ opacity }}>
      {text}
    </motion.span>
  );
}

export function SplitText({
  className,
  delay = 0,
  mode = 'words',
  playOnMount = false,
  scrub = false,
  text,
}: SplitTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.82', 'end 0.28'],
  });
  const words = text.trim().split(/\s+/);

  useEffect(() => {
    if (playOnMount && !reduceMotion) setReady(true);
  }, [playOnMount, reduceMotion]);

  if (mode === 'line') {
    // A line entrance must start HIDDEN. `initial={false}` would paint the
    // line at rest for one frame and then jump it back up out of the mask,
    // which reads as a flash. So when the entrance is armed the initial state
    // is the hidden offset, and the text only rises once `ready` flips.
    const entrance = playOnMount && !reduceMotion;
    return (
      <span ref={ref} className={`sk-motion-line-mask ${className ?? ''}`}>
        <span className="sk-motion-sr-only">{text}</span>
        <motion.span
          aria-hidden="true"
          className="sk-motion-line"
          initial={entrance ? { y: '108%' } : false}
          animate={
            entrance
              ? ready
                ? { y: '0%' }
                : { y: '108%' }
              : { y: 0 }
          }
          transition={{
            duration: landingMotion.duration.hero,
            delay,
            ease: landingMotion.ease,
          }}
        >
          {text}
        </motion.span>
      </span>
    );
  }

  return (
    <span ref={ref} className={`sk-motion-split ${className ?? ''}`}>
      <span className="sk-motion-sr-only">{text}</span>
      <span aria-hidden="true" className="sk-motion-split__visual">
        {words.map((word, index) => (
          <React.Fragment key={`${word}-${index}`}>
            {scrub && !reduceMotion ? (
              <ScrubWord
                index={index}
                progress={scrollYProgress}
                text={word}
                total={words.length}
              />
            ) : (
              <span className="sk-motion-word">{word}</span>
            )}
            {index < words.length - 1 ? ' ' : null}
          </React.Fragment>
        ))}
      </span>
    </span>
  );
}
