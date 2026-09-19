'use client';

import { Sheet } from '@/components/ui/Sheet';
import { NewMapForm } from './NewMapForm';

/**
 * "New map" as a bottom sheet over the map (design reference, screen 08).
 *
 * A thin wrapper, and deliberately so: it owns no form state, no validation
 * and no create call. `NewMapForm` already does all of that and is what
 * `/maps/new` renders, so the sheet and the page cannot drift — a template
 * added to `lib/editor/templates` appears in both, and a fix to the create
 * request fixes both.
 *
 * §08 calls this a modal and the route page's own comment argues for a full
 * page instead. Both are right, for different entry points: arriving at
 * `/maps/new` deserves the room and a bookmarkable URL, while pressing + on
 * the map should not throw the map away to ask for a title. Same component,
 * two presentations — the pattern the node detail already uses for sheet
 * versus inspector.
 */

export interface NewMapSheetProps {
  open: boolean;
  onClose: () => void;
}

export function NewMapSheet({ open, onClose }: NewMapSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="New map" placement="bottom">
      {/*
       * The heading is suppressed on the form because the Sheet header already
       * carries it beside the close button.
       *
       * `onCreated` closes the sheet before the router navigates to the new
       * editor. Without it the sheet is still mounted during the transition
       * and reappears over the editor for a frame — and if the user comes
       * back, it is still open over a map they have already left.
       */}
      <NewMapForm hideTitle onCreated={onClose} />
    </Sheet>
  );
}
