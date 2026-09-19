import type { Step } from './workflows';

/**
 * Editing a step list without silently breaking its branches.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * A `condition` step jumps to an ABSOLUTE index when its test fails. That was
 * the right choice — a relative offset points somewhere else the moment a step
 * above it is inserted — but absolute indices have the mirror problem: moving,
 * inserting or deleting a step changes what every index refers to.
 *
 * So a builder that just reorders the array is a builder that silently
 * reroutes branches. Nothing errors, nothing looks wrong, and the workflow
 * quietly does something else. That is the worst class of bug in an automation
 * tool, because the failure surfaces as behaviour rather than as a message.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 * Every operation here returns a NEW list with jump targets remapped through
 * the same permutation it applied to the steps. These are pure functions with
 * no React in them, because the mapping is the part worth testing and a test
 * that has to render a component to check an index is a test nobody writes.
 */

/** Rewrite each condition's target through an old-index to new-index map. */
function remap(steps: Step[], mapIndex: (old: number) => number): Step[] {
  return steps.map((step) =>
    step.type === 'condition'
      ? { ...step, elseGoto: mapIndex(step.elseGoto) }
      : step,
  );
}

/**
 * Move a step, carrying every branch that pointed at it.
 *
 * The permutation is derived from where each element ENDED UP, not computed by
 * arithmetic on `from` and `to` — the arithmetic has four cases depending on
 * direction and whether an index sits inside the moved range, and getting one
 * of them wrong is exactly the silent failure this exists to prevent.
 */
export function moveStep(steps: Step[], from: number, to: number): Step[] {
  if (from === to || from < 0 || to < 0) return steps;
  if (from >= steps.length || to >= steps.length) return steps;

  // Track each element's original index alongside it through the move.
  const tagged = steps.map((step, index) => ({ step, index }));
  const [moved] = tagged.splice(from, 1);
  if (!moved) return steps;
  tagged.splice(to, 0, moved);

  const oldToNew = new Map<number, number>();
  tagged.forEach((entry, newIndex) => oldToNew.set(entry.index, newIndex));

  return remap(
    tagged.map((entry) => entry.step),
    (old) => oldToNew.get(old) ?? old,
  );
}

/**
 * Remove a step.
 *
 * A branch that pointed AT the removed step is retargeted to whatever now
 * occupies that slot — "carry on from where it was" — rather than being reset
 * to zero, which would turn a delete into an accidental loop back to the top.
 *
 * If the removed step was last, the target becomes the new length. The engine
 * treats a cursor past the end as finished, so that reads as "stop", which is
 * the honest meaning when the thing you were jumping to is gone.
 */
export function removeStep(steps: Step[], index: number): Step[] {
  if (index < 0 || index >= steps.length) return steps;

  const next = steps.filter((_, i) => i !== index);

  return remap(next, (old) => {
    if (old > index) return old - 1;
    // old === index: the step that slid into the gap. Clamped so a trailing
    // delete produces "past the end" rather than an index into nothing.
    return Math.min(old, next.length);
  });
}

/** Insert a step, pushing every target at or after the insertion point. */
export function insertStep(steps: Step[], index: number, step: Step): Step[] {
  const at = Math.max(0, Math.min(index, steps.length));
  const next = [...steps.slice(0, at), step, ...steps.slice(at)];

  return remap(next, (old) => (old >= at ? old + 1 : old));
}

/** Replace one step in place. Indices are unchanged, so nothing is remapped. */
export function updateStep(steps: Step[], index: number, step: Step): Step[] {
  if (index < 0 || index >= steps.length) return steps;
  return steps.map((existing, i) => (i === index ? step : existing));
}

export interface StepProblem {
  index: number;
  message: string;
}

/**
 * Problems worth showing before a workflow is saved.
 *
 * Deliberately NOT the zod schema — that answers "is this storable", and the
 * API already enforces it. This answers "will this do what you meant", which
 * is a different and softer question: everything here is valid enough to save
 * and still probably a mistake.
 */
export function inspect(steps: Step[]): StepProblem[] {
  const problems: StepProblem[] = [];

  steps.forEach((step, index) => {
    if (step.type === 'condition') {
      /*
       * A backward jump is a loop, and loops are allowed — that is how a
       * retry is built. It is worth SAYING though, because someone dragging
       * steps around can create one without meaning to, and the engine's
       * 200-step ceiling is the only other thing that would tell them.
       */
      if (step.elseGoto <= index) {
        problems.push({
          index,
          message: 'This jumps backwards, which creates a loop.',
        });
      }

      if (step.elseGoto > steps.length) {
        problems.push({
          index,
          message: 'This jumps past the end, so the run would stop here.',
        });
      }

      /*
       * A condition testing a key nothing sets can never pass, so the workflow
       * always takes the else branch. Valid, storable, and almost certainly
       * not what was intended.
       */
      const setsKey = steps.some(
        (other, otherIndex) =>
          otherIndex < index && other.type === 'set' && other.key === step.key,
      );

      if (!setsKey) {
        problems.push({
          index,
          message: `Nothing above sets "${step.key}", so this always takes the else branch.`,
        });
      }
    }

    if (step.type === 'agent' && !step.agentId) {
      problems.push({ index, message: 'Choose an agent for this step.' });
    }
  });

  return problems;
}

/** A new step of the given type, with defaults that are valid to save. */
export function blankStep(type: Step['type'], stepCount: number): Step {
  switch (type) {
    case 'agent':
      return { type: 'agent', agentId: '', goal: '' };
    case 'approve':
      return { type: 'approve', prompt: 'May this continue?' };
    case 'condition':
      // Defaults to jumping past the end, which stops the run — a safe target
      // that is obviously a placeholder rather than a silent jump to step 0.
      return { type: 'condition', key: '', equals: '', elseGoto: stepCount + 1 };
    case 'set':
      return { type: 'set', key: '', value: '' };
  }
}
