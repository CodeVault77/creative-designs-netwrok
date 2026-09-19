'use client';

import type { ReactNode } from 'react';
import styled from 'styled-components';

/**
 * EmptyState.
 *
 * §08 specifies real copy for every empty state, and the reason is §24: My
 * Maps with nothing in it is the screen standing between a new account and
 * the activation metric. An empty list with no next action is where activation
 * goes to die.
 *
 * So the shape is fixed: say what would be here, say why it is worth having,
 * and offer the one action that fills it. Never just "No maps".
 */

const Root = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);

  padding: var(--space-16) var(--space-4);
  text-align: center;

  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-card);
`;

const Title = styled.p`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const Body = styled.p`
  margin: 0;
  max-width: 30rem;
  color: var(--ground-muted);
  line-height: var(--leading-body);
`;

export interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <Root>
      <Title>{title}</Title>
      <Body>{body}</Body>
      {action}
    </Root>
  );
}
