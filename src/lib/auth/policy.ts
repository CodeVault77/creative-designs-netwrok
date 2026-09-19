/**
 * Password policy constants, shared by the server and the browser.
 *
 * Deliberately NOT in `password.ts`: that module is `server-only`, so a client
 * component importing the minimum from it would fail the build. And
 * deliberately not in the strength meter either, because `lib` importing from
 * `components` is backwards.
 *
 * This exists so there is exactly one 10 in the codebase. There were two — the
 * server's rule in `checkPassword` and the meter's own constant — with a
 * comment claiming they were shared when nothing connected them. A meter that
 * disagrees with the validator is worse than no meter: it either tells someone
 * their password is fine and then the server rejects it, or marks it weak
 * while the server is happy.
 *
 * §11 sets length as the only rule. Composition requirements ("one uppercase,
 * one symbol") measurably push people toward `Password1!` and into reuse; NIST
 * dropped them years ago.
 */

/** §11: the minimum the server enforces and the meter reports against. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Bounded because scrypt hashes the whole input, so an unbounded password is
 * an unbounded amount of work per sign-in attempt.
 */
export const MAX_PASSWORD_LENGTH = 200;
