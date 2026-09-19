'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import styled from 'styled-components';
import { Button, TextField } from '@/components/ui';
import { TEMPLATES } from '@/lib/editor/templates';
import { transition } from '@/lib/styles/motion';
import { buildRoute } from '@/lib/routes';
import { track } from '@/lib/analytics';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Screen 08 — New map.
 *
 * Two decisions serve the §20 criterion (blank → ten nodes in under three
 * minutes):
 *
 *   - the name field is autofocused, so the first keystroke lands where it
 *     should with no aiming;
 *   - Blank is preselected. A template that does not fit costs more to edit
 *     into shape than an empty map costs to fill, so the safe default wins
 *     and templates are there for people who recognise one.
 */

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: 34rem;
`;

const Title = styled.h1`
  margin: 0;
  font-size: var(--text-display-m);
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const Label = styled.h2`
  margin: 0;
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  color: var(--ground-muted);
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2);
`;

const Tile = styled.button<{ $selected: boolean; $family: FamilyName }>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;

  padding: var(--space-3);
  text-align: left;

  background: ${({ theme, $selected, $family }) =>
    $selected ? theme.tokens.familyRamp[$family].wash : 'transparent'};
  border: 1px solid
    ${({ theme, $selected, $family }) =>
      $selected ? theme.tokens.familyRamp[$family].core : 'var(--ground-border)'};
  border-radius: var(--radius-card);
  color: var(--ground-ink);
  font: inherit;
  cursor: pointer;

  ${transition('selection', 'background-color', 'border-color')}

  &:hover:not(:disabled) {
    border-color: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const TileName = styled.span`
  font-family: var(--face-display);
  font-size: var(--text-body);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
`;

const TileDescription = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
  line-height: 1.4;
`;

const SoonBadge = styled.span`
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  font-family: var(--face-mono);
  font-size: 9px;
  color: var(--fam-services-core);
  border: 1px solid var(--fam-services-core);
  border-radius: 3px;
  padding: 0 4px;
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
`;

export interface NewMapFormProps {
  /**
   * Suppresses the form's own heading.
   *
   * Inside a sheet the Sheet primitive already renders "New map" in its header
   * row, next to the close button. Two headings one above the other read as a
   * layout bug, and the second one is not a landmark a screen reader needs
   * announced twice.
   */
  hideTitle?: boolean;
  /** Called after a map is created, so a sheet can close itself. */
  onCreated?: (mapId: string) => void;
}

export function NewMapForm({ hideTitle = false, onCreated }: NewMapFormProps = {}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('blank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;

      setBusy(true);
      setError(null);

      try {
        const response = await fetch('/api/maps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), templateId }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          // §08 screen 08: "Name conflict inline; network error keeps the
          // modal and the input." The form is never discarded on failure —
          // retyping a name you already typed is the most annoying possible
          // response to a server problem.
          setError(body.error ?? "Couldn't create the map. Try again.");
          return;
        }

        const { id } = await response.json();
        track('map_created', {
          source: templateId === 'blank' ? 'blank' : 'template',
          template_id: templateId,
        });
        onCreated?.(id);
        router.push(buildRoute.mapEditor(id));
      } catch {
        setError("Couldn't reach the server. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [title, templateId, busy, router, onCreated],
  );

  return (
    <Form onSubmit={submit}>
      {!hideTitle && <Title>New map</Title>}

      {/*
        NOT `required`.
        
        It was, and that is what made the create button appear broken: the
        browser blocked submission on the empty field before any request left
        the page, so the click did nothing and said nothing. Removing the
        disabled state alone was not enough — native validation was a second,
        invisible gate behind it.
        
        The hint says the field is optional so the empty state is a choice
        rather than an oversight.
      */}
      <TextField
        label="Name"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What is this map about?"
        hint="Optional — you can rename it any time."
        maxLength={60}
        autoFocus
        {...(error ? { error } : {})}
      />

      <Section>
        <Label>Start from</Label>
        <Grid>
          {TEMPLATES.map((template) => (
            <Tile
              key={template.id}
              type="button"
              $selected={templateId === template.id}
              $family={template.family}
              disabled={template.soon}
              onClick={() => setTemplateId(template.id)}
              aria-pressed={templateId === template.id}
            >
              {template.soon && <SoonBadge>SOON</SoonBadge>}
              <TileName>{template.name}</TileName>
              <TileDescription>{template.description}</TileDescription>
            </Tile>
          ))}
        </Grid>
      </Section>

      <Actions>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          /*
            Never disabled on an empty name. A greyed-out button with nothing
            explaining it is a dead end: you can pick a template, see the
            action you want, and have no way to learn what is missing. The
            server fills in a unique "Untitled map" when the field is blank,
            and renaming is one tap away once the map exists.
          */
        >
          Create map
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </Actions>
    </Form>
  );
}
