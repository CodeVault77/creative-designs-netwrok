import Link from 'next/link';
import { LogoMark } from '@/components/brand/LogoMark';
import { routes } from '@/lib/routes';
import styles from './entry.module.css';

export const metadata = {
  title: 'Creative Design Networks',
  description: 'A spatial browser. God gives the vision. We build the connections.',
};

/**
 * Screen 01 — the entry transition.
 *
 * Ported from the design canvas ("01 Entry"). Outside the app chrome on
 * purpose: the brand moment should not have a tab bar under it.
 *
 * A SERVER component with a CSS module and no client boundary anywhere in the
 * tree. That is the whole design constraint of this screen — it has to paint
 * immediately, and every `'use client'` in here is JavaScript standing between
 * the user and the first thing they see. The nudge on the hand is a CSS
 * animation for the same reason.
 *
 * The canvas hangs `onClick` off the screen container; here the target is a
 * real <Link> covering the frame, so it is reachable by keyboard, announced
 * properly, and works before hydration. Same visuals, same gesture.
 */
export default function EntryPage() {
  return (
    <div className={styles.page}>
      <div className={styles.atmosphere} aria-hidden="true" />

      {/*
       * The constellation along the bottom edge. Decorative: it carries no
       * information the labels do not, so it is hidden rather than described.
       */}
      <svg
        className={styles.constellation}
        viewBox="0 0 390 200"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <g stroke="#3B2A6B" strokeWidth=".7">
          <path d="M-20 150 120 96 250 148 400 92" />
          <path d="M-20 84 96 150 232 88 370 156" />
          <path d="M40 200 120 96 96 150 40 200" />
          <path d="M250 148 232 88 320 190" />
          <path d="M120 96 232 88" />
          <path d="M96 150 250 148" />
        </g>
        <g fill="#6D4BC9">
          <circle cx="120" cy="96" r="2" />
          <circle cx="250" cy="148" r="2" />
          <circle cx="96" cy="150" r="1.6" />
          <circle cx="232" cy="88" r="1.6" />
          <circle cx="320" cy="190" r="1.6" />
        </g>
      </svg>

      <Link
        href={routes.map}
        className={styles.enter}
        aria-label="Enter the network"
      >
        <div className={styles.ring}>
          <div className={styles.ringInner}>
            <LogoMark size={36} glow className={styles.mark} />

            {/*
             * One accessible name for the lockup, so a screen reader says the
             * company name once rather than reading three coloured runs.
             */}
            <p
              className={styles.wordmark}
              role="img"
              aria-label="Creative Design Networks"
            >
              <span
                className={`${styles.word} ${styles.creative}`}
                aria-hidden="true"
              >
                CREATIVE
              </span>
              <span
                className={`${styles.word} ${styles.design}`}
                aria-hidden="true"
              >
                DESIGN
              </span>
              <span
                className={`${styles.word} ${styles.networks}`}
                aria-hidden="true"
              >
                NETWORKS
              </span>
            </p>

            <p className={styles.tagline}>THE CENTRAL NODE</p>
          </div>
        </div>

        <div className={styles.prompt}>
          {/*
           * aria-hidden: the link already announces "Enter the network", and
           * "TAP TO ENTER" would otherwise be read straight after it as a
           * second, contradictory instruction for anyone not tapping.
           */}
          <span className={styles.promptText} aria-hidden="true">
            TAP TO ENTER
          </span>

          <svg
            className={styles.hand}
            width="42"
            height="52"
            viewBox="0 0 42 52"
            fill="none"
            stroke="#8B5CF6"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 26V10a4 4 0 0 1 8 0v13" />
            <path d="M23 18.5a3.4 3.4 0 0 1 6.8 0V24" />
            <path d="M29.8 21.5a3.4 3.4 0 0 1 6.8 0v11.8c0 8.2-5 14.7-12.6 14.7h-3.2C15.4 48 12 44.6 9.4 39L5.6 32c-1-1.9-.3-4 1.5-5 1.7-1 3.8-.4 4.9 1.3L15 33" />
          </svg>
        </div>
      </Link>
    </div>
  );
}
