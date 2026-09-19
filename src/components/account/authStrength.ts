/**
 * Password strength — LENGTH ONLY.
 *
 * §11 (docs/11-accounts.md) sets a 10-character minimum and deliberately no
 * composition rules: forced symbol and digit classes push people toward
 * `Password1!` and away from the long passphrase that is actually stronger.
 * A meter that scored character classes would contradict the policy the API
 * enforces, and a meter that disagrees with the server is worse than none —
 * it tells the user their password is weak while the server accepts it.
 *
 * So this scores the one thing the policy cares about, and the copy says
 * which. Shared with the API's validator via MIN_PASSWORD_LENGTH.
 */

/*
 * Re-exported, not redeclared. The number lives in `lib/auth/policy` so the
 * meter and the server's validator cannot drift apart; this keeps the existing
 * import path working for everything in this folder.
 */
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/policy';
export { MIN_PASSWORD_LENGTH };

/** Above this, extra length stops meaningfully changing the advice. */
const STRONG_LENGTH = 16;

export type StrengthLevel = 0 | 1 | 2 | 3;

export interface Strength {
  level: StrengthLevel;
  label: string;
  hint: string;
  /** A CSS var, so the meter cannot drift from the semantic palette. */
  colorVar: string;
}

export function strengthOf(password: string): Strength {
  const length = password.length;

  if (length === 0) {
    return {
      level: 0,
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      hint: 'a short phrase works well',
      colorVar: 'var(--ground-muted)',
    };
  }

  if (length < MIN_PASSWORD_LENGTH) {
    const missing = MIN_PASSWORD_LENGTH - length;
    return {
      level: 1,
      label: 'Too short',
      hint: `${missing} more character${missing === 1 ? '' : 's'} needed`,
      colorVar: 'var(--color-danger)',
    };
  }

  if (length < STRONG_LENGTH) {
    return {
      level: 2,
      label: 'Good',
      hint: 'long enough',
      colorVar: 'var(--color-warning)',
    };
  }

  return {
    level: 3,
    label: 'Strong',
    hint: 'a passphrase is the easiest strong password',
    colorVar: 'var(--color-success)',
  };
}
