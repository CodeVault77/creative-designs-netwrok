'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { Button, TextField } from '@/components/ui';
import { routes } from '@/lib/routes';
import { transition } from '@/lib/styles/motion';
import { AuthBackdrop } from './AuthBackdrop';
import { AuthHeader, AuthRing } from './AuthBrand';
import { PasswordField } from './PasswordField';
import { MIN_PASSWORD_LENGTH } from './authStrength';

/**
 * Sign in and sign up — one component, two modes.
 *
 * They differ by exactly one field and one endpoint. Two files would drift,
 * and the thing that would drift is the error handling, which is the part
 * that matters most on an auth form.
 *
 * ── What changed from the P6 version ────────────────────────────────────────
 *
 * The form logic and the API contract are untouched. What is new is that this
 * screen now looks like it belongs to the product: it owns its own background
 * and brand header instead of rendering as a card inside the app shell, and
 * the password field carries a visibility toggle and (on sign-up) a length
 * meter. The field set did NOT change — name, email, password — because §11
 * argues against confirm fields and composition rules, and a form that asks
 * for more than the API stores is a form that lies about what it needs.
 *
 * The value copy above the form is not decoration. §08 screen 07's permission
 * state calls for a "sign-in prompt with value copy", and this is the screen
 * standing between a first visit and §24's activation metric — someone who
 * lands here from a protected route needs a reason to continue, not just a
 * password box.
 */

const Screen = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;

  /*
   * The auth screens paint their own ground rather than sitting on the shell's.
   * The map is pure black, the app surfaces are raised — this is between the
   * two, so the atmosphere behind the form has somewhere to sit.
   */
  background: var(--ground-canvas);
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
`;

const Content = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;

  /*
   * Scrolls rather than compressing when the keyboard opens. A min-height of
   * zero is what lets a flex child actually scroll instead of growing its
   * parent — without it the submit button ends up under the keyboard on a
   * small phone with no way to reach it.
   */
  min-height: 0;
  overflow-y: auto;
`;

const Column = styled.div`
  width: 100%;
  max-width: 26rem;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-2) var(--space-4) var(--space-8);
  box-sizing: border-box;
`;

const Brand = styled.div`
  display: flex;
  justify-content: center;
  padding: var(--space-2) 0 var(--space-4);
`;

const Heading = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const Title = styled.h1`
  margin: 0;
  font-size: var(--text-display-m);
  line-height: 1.2;
`;

const Value = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: var(--leading-body);
  text-wrap: pretty;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Spacer = styled.div`
  flex: 1;
  min-height: var(--space-6);
`;

const Switch = styled.p`
  margin: 0;
  text-align: center;
  font-size: var(--text-label);
  color: var(--ground-muted);

  a {
    color: var(--fam-discover-core);
    font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
    text-decoration: none;

    ${transition('selection', 'color')}

    &:hover {
      color: var(--fam-organise-core);
    }
  }
`;

const ForgotLink = styled(Link)`
  font-size: var(--text-label);
  color: var(--fam-discover-core);
  text-decoration: none;

  ${transition('selection', 'color')}

  &:hover {
    color: var(--fam-organise-core);
  }
`;

const Notice = styled.p`
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--fam-discover-wash);
  border: 1px solid var(--fam-discover-core);
  border-radius: var(--radius-control);
  font-size: var(--text-label);
  line-height: var(--leading-body);
  color: var(--ground-ink);
`;

/**
 * A form-level error, as opposed to a field-level one.
 *
 * Icon AND border AND text, never colour alone — §16's accessibility rule.
 * Sign-in's message is deliberately vague about WHICH credential was wrong;
 * §11 keeps that asymmetry because saying "no account with that email" turns
 * the form into a way to test whether an address is registered.
 */
const ErrorBanner = styled.div`
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: rgba(255, 77, 109, 0.08);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-control);
`;

const ErrorText = styled.span`
  font-size: var(--text-label);
  line-height: var(--leading-body);
  color: var(--ground-ink);
`;

const Terms = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  line-height: var(--leading-body);
  color: var(--ground-muted);

  a {
    color: var(--fam-discover-core);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;

function AlertIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-danger)"
      strokeWidth="1.8"
      aria-hidden="true"
      style={{ flex: 'none', marginTop: 1 }}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v6M12 16.5v.01" strokeLinecap="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.6 7 8.4 6 8.4-6" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
    </svg>
  );
}

export interface AuthFormProps {
  mode: 'sign-in' | 'sign-up';
  /** Where to go after success. Comes from the guard's `returnTo`. */
  returnTo?: string;
  /**
   * Password reset destination.
   *
   * Optional and unset by default: §11 lists reset as an open gap (it needs
   * email delivery, P14). Pass an href once that route exists — a visible
   * "Forgot password?" pointing at a 404 is worse than none, because it is
   * discovered by exactly the user who is already locked out.
   */
  forgotHref?: string;
}

export function AuthForm({ mode, returnTo, forgotHref }: AuthFormProps) {
  const isSignUp = mode === 'sign-up';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(
    null,
  );

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;

      setBusy(true);
      setError(null);

      try {
        const response = await fetch(
          isSignUp ? '/api/auth/sign-up' : '/api/auth/sign-in',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              isSignUp ? { email, password, displayName } : { email, password },
            ),
          },
        );

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          /*
           * An account that signs in through an identity provider gets sent
           * there instead of being told its password is wrong. The password
           * IS wrong — the stored hash is a sentinel no password produces —
           * but saying so would leave somebody typing their company password
           * into a form that can never accept it.
           */
          if (body.useSso && body.connectionId) {
            window.location.href = `/api/sso/start?connection=${encodeURIComponent(
              body.connectionId,
            )}&returnTo=${encodeURIComponent(returnTo ?? routes.maps)}`;
            return;
          }

          setError({
            message: body.error ?? 'Something went wrong',
            field: body.field,
          });
          return;
        }

        /*
         * The password was right and a second factor is now required.
         *
         * The session exists but is PENDING — `getSession` returns null for it
         * — so navigating anywhere else would bounce straight back to
         * sign-in. The challenge screen is the only thing a pending session
         * can reach.
         */
        if (body.mfaRequired) {
          window.location.href = `/sign-in/verify?returnTo=${encodeURIComponent(
            returnTo ?? routes.maps,
          )}`;
          return;
        }

        // A full navigation, not router.push: the session cookie was just set
        // and every server component needs to re-render with it. A client-side
        // transition would keep the signed-out render.
        window.location.href =
          returnTo && returnTo.startsWith('/') ? returnTo : routes.maps;
      } catch {
        setError({ message: "Couldn't reach the server. Try again." });
      } finally {
        setBusy(false);
      }
    },
    [busy, isSignUp, email, password, displayName, returnTo],
  );

  const fieldError = (field: string) =>
    error?.field === field ? { error: error.message } : {};

  return (
    <Screen>
      <AuthBackdrop />

      <Content>
        <AuthHeader />

        <Column>
          {/*
            The ring only appears on sign-in. Sign-up has four controls and a
            terms line to fit, and pushing them down for a second brand moment
            is the wrong trade on a small phone — the header lockup already
            says which product this is.
          */}
          {!isSignUp && (
            <Brand>
              <AuthRing size={128} />
            </Brand>
          )}

          <Heading>
            <Title>{isSignUp ? 'Create your network' : 'Welcome back'}</Title>
            <Value>
              {isSignUp
                ? 'Build your own maps, save them, and share them with a link. Free, and your private maps stay private.'
                : 'Sign in to continue to your network.'}
            </Value>
          </Heading>

          {returnTo && !isSignUp && (
            <Notice>Sign in to continue to {returnTo}</Notice>
          )}

          {error && !error.field && (
            <ErrorBanner role="alert">
              <AlertIcon />
              <ErrorText>{error.message}</ErrorText>
            </ErrorBanner>
          )}

          <Form onSubmit={submit}>
            {isSignUp && (
              <TextField
                label="Your name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="What should we call you?"
                iconStart={<PersonIcon />}
                maxLength={60}
                autoComplete="name"
                autoFocus
                required
                {...fieldError('displayName')}
              />
            )}

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              iconStart={<MailIcon />}
              autoComplete="email"
              autoFocus={!isSignUp}
              required
              {...fieldError('email')}
            />

            <PasswordField
              value={password}
              onChange={setPassword}
              showStrength={isSignUp}
              // Tells the browser's password manager which flow this is, so it
              // offers to save on sign-up and to fill on sign-in.
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              {...(isSignUp
                ? { placeholder: 'A short phrase works well' }
                : { placeholder: '••••••••••' })}
              {...(forgotHref && !isSignUp
                ? {
                    labelAction: (
                      <ForgotLink href={forgotHref}>Forgot password?</ForgotLink>
                    ),
                  }
                : {})}
              required
              {...fieldError('password')}
            />

            {isSignUp && (
              <Terms>
                By creating an account you agree to the{' '}
                <Link href={routes.terms}>Terms</Link> and the{' '}
                <Link href={routes.privacy}>Privacy Policy</Link>.
              </Terms>
            )}

            <Button type="submit" variant="primary" loading={busy} fullWidth>
              {isSignUp ? 'Create account' : 'Log in'}
            </Button>
          </Form>

          <Spacer />

          <Switch>
            {isSignUp ? (
              <>
                Already have an account? <Link href="/sign-in">Log in</Link>
              </>
            ) : (
              <>
                New to the network? <Link href="/sign-up">Create an account</Link>
              </>
            )}
          </Switch>
        </Column>
      </Content>
    </Screen>
  );
}

export { MIN_PASSWORD_LENGTH };
