'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { Visibility } from '@/lib/sharing/payload';

/**
 * VisibilityPicker + the node-viewable toggle (§08 screen 11).
 *
 * Together because they are one decision — "who can see this, and how much" —
 * and because node-viewable only means anything once a map is shared. Showing
 * it against a private map would ask people to configure something with no
 * effect.
 *
 * The copy says what each setting DOES, not what it is called. "Public" alone
 * does not tell anyone it will appear in search; that is the part people are
 * surprised by afterwards.
 */

const Group = styled.fieldset`
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const Legend = styled.legend`
  padding: 0;
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  color: var(--ground-muted);
`;

const Option = styled.button<{ $selected: boolean; $warn: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;

  width: 100%;
  padding: var(--space-3);
  text-align: left;

  background: ${({ $selected }) => ($selected ? 'rgba(255,255,255,0.04)' : 'transparent')};
  border: 1px solid
    ${({ theme, $selected, $warn }) =>
      $selected
        ? $warn
          ? 'var(--color-warning)'
          : theme.tokens.familyRamp[theme.family].core
        : 'var(--ground-border)'};
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font: inherit;
  cursor: pointer;

  ${transition('selection', 'border-color', 'background-color')}

  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const OptionTitle = styled.span`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
`;

const OptionBody = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
  line-height: 1.45;
`;

const Toggle = styled.button<{ $on: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);

  width: 100%;
  padding: var(--space-3);
  text-align: left;

  background: transparent;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font: inherit;
  cursor: pointer;

  ${transition('selection', 'border-color')}

  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Switch = styled.span<{ $on: boolean }>`
  flex-shrink: 0;
  position: relative;
  width: 38px;
  height: 22px;
  margin-top: 2px;
  border-radius: var(--radius-pill);

  background: ${({ theme, $on }) =>
    $on ? theme.tokens.familyRamp[theme.family].wash : 'var(--ground-raised)'};
  border: 1px solid
    ${({ theme, $on }) =>
      $on ? theme.tokens.familyRamp[theme.family].core : 'var(--ground-border)'};

  ${transition('selection', 'background-color', 'border-color')}

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ $on }) => ($on ? '18px' : '3px')};
    width: 14px;
    height: 14px;
    border-radius: var(--radius-circle);
    background: ${({ theme, $on }) =>
      $on ? theme.tokens.familyRamp[theme.family].core : 'var(--ground-muted)'};
    transition: left var(--duration-selection) var(--ease-selection);
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      transition: none;
    }
  }
`;

const ToggleText = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const OPTIONS: {
  id: Visibility;
  title: string;
  body: string;
  warn: boolean;
}[] = [
  {
    id: 'private',
    title: 'Private',
    body: 'Only you and people you invite.',
    warn: false,
  },
  {
    id: 'link',
    title: 'Anyone with the link',
    body: 'Read-only. Not listed anywhere and not indexed by search engines.',
    warn: true,
  },
  {
    id: 'public',
    title: 'Public',
    // Says the surprising part out loud, before the choice rather than after.
    body: 'Read-only, and it can appear in CDN search and Page Watcher.',
    warn: true,
  },
];

export interface VisibilityPickerProps {
  visibility: Visibility;
  nodeViewable: boolean;
  onChange: (next: { visibility: Visibility; nodeViewable: boolean }) => void;
  disabled?: boolean;
}

export function VisibilityPicker({
  visibility,
  nodeViewable,
  onChange,
  disabled = false,
}: VisibilityPickerProps) {
  const shared = visibility !== 'private';

  return (
    <>
      <Group>
        <Legend>Who can see this map</Legend>
        {OPTIONS.map((option) => (
          <Option
            key={option.id}
            type="button"
            $selected={visibility === option.id}
            $warn={option.warn && visibility === option.id}
            disabled={disabled}
            onClick={() => onChange({ visibility: option.id, nodeViewable })}
            aria-pressed={visibility === option.id}
          >
            <OptionTitle>
              {option.title}
              {option.warn && visibility === option.id && (
                <svg
                  viewBox="0 0 16 16"
                  width="13"
                  height="13"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M8 2.5 14.5 13.5h-13L8 2.5Z"
                    stroke="var(--color-warning)"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 6.5v3"
                    stroke="var(--color-warning)"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="11.5" r="0.7" fill="var(--color-warning)" />
                </svg>
              )}
            </OptionTitle>
            <OptionBody>{option.body}</OptionBody>
          </Option>
        ))}
      </Group>

      {/*
        Only meaningful once the map is shared. Against a private map it would
        be a control with no effect, which teaches people that controls here
        do not matter.
      */}
      {shared && (
        <Group>
          <Legend>How much they can see</Legend>
          <Toggle
            type="button"
            $on={nodeViewable}
            disabled={disabled}
            onClick={() => onChange({ visibility, nodeViewable: !nodeViewable })}
            aria-pressed={nodeViewable}
          >
            <Switch $on={nodeViewable} aria-hidden="true" />
            <ToggleText>
              <OptionTitle>Let them open nodes</OptionTitle>
              <OptionBody>
                {nodeViewable
                  ? 'Viewers can open a node to read its description and follow its links.'
                  : 'Viewers see the shape, the titles and the connections — but taps do not open anything. The detail is not sent to their browser at all.'}
              </OptionBody>
            </ToggleText>
          </Toggle>
        </Group>
      )}
    </>
  );
}
