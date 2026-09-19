import { describe, expect, it } from 'vitest';
import type { Step } from './workflows';
import {
  blankStep,
  insertStep,
  inspect,
  moveStep,
  removeStep,
  updateStep,
} from './steps';

/**
 * The whole point of this module is that editing a list must not silently
 * reroute a branch. So every test below checks WHERE THE JUMP ENDS UP, not
 * merely that the steps moved — the steps moving is the easy half, and a test
 * that only checks the order would pass while the workflow quietly did
 * something else.
 */

const set = (key: string): Step => ({ type: 'set', key, value: 'x' });
const jump = (to: number): Step => ({
  type: 'condition',
  key: 'k',
  equals: 'v',
  elseGoto: to,
});

/** Names the steps so a failure reads as an order, not as four objects. */
const names = (steps: Step[]) =>
  steps.map((step) =>
    step.type === 'set' ? step.key : `->${(step as { elseGoto: number }).elseGoto}`,
  );

describe('moveStep', () => {
  it('carries a branch that pointed at the moved step', () => {
    // 0:a  1:b  2:jump->1  — the jump targets b.
    const steps = [set('a'), set('b'), jump(1)];

    // Move b to the front: b is now 0, so the jump must follow it.
    const moved = moveStep(steps, 1, 0);

    expect(names(moved)).toEqual(['b', 'a', '->0']);
  });

  it('carries a branch when the target moves later', () => {
    const steps = [set('a'), set('b'), set('c'), jump(0)];

    // a goes to the end; the jump targeted a, so it must now point at 2.
    const moved = moveStep(steps, 0, 2);

    expect(names(moved)).toEqual(['b', 'c', 'a', '->2']);
  });

  it('follows the condition itself when the condition is what moved', () => {
    const steps = [set('a'), set('b'), jump(0)];
    const moved = moveStep(steps, 2, 0);

    // The jump still targets a, which is now at index 1.
    expect(names(moved)).toEqual(['->1', 'a', 'b']);
  });

  it('leaves untargeted branches alone', () => {
    const steps = [jump(0), set('a'), set('b')];
    const moved = moveStep(steps, 1, 2);

    expect(names(moved)).toEqual(['->0', 'b', 'a']);
  });

  it('is a no-op for a move that changes nothing', () => {
    const steps = [set('a'), jump(0)];

    expect(moveStep(steps, 1, 1)).toBe(steps);
    expect(moveStep(steps, 5, 0)).toBe(steps);
    expect(moveStep(steps, -1, 0)).toBe(steps);
  });
});

describe('removeStep', () => {
  it('shifts branches that pointed after the removed step', () => {
    const steps = [set('a'), set('b'), set('c'), jump(2)];
    const next = removeStep(steps, 0);

    // c was 2, is now 1.
    expect(names(next)).toEqual(['b', 'c', '->1']);
  });

  it('retargets a branch that pointed AT the removed step', () => {
    const steps = [set('a'), set('b'), set('c'), jump(1)];
    const next = removeStep(steps, 1);

    /*
     * b is gone; the jump now points at whatever slid into its slot — c.
     * Resetting to 0 instead would turn a delete into an accidental loop back
     * to the top, which is the failure this rule exists to avoid.
     */
    expect(names(next)).toEqual(['a', 'c', '->1']);
  });

  it('turns a branch into "stop" when its target was the last step', () => {
    const steps = [jump(2), set('a'), set('b')];
    const next = removeStep(steps, 2);

    // Past the end, which the engine treats as finished.
    expect(names(next)).toEqual(['->2', 'a']);
  });

  it('ignores an index that is not there', () => {
    const steps = [set('a')];
    expect(removeStep(steps, 9)).toBe(steps);
  });
});

describe('insertStep', () => {
  it('pushes branches at or after the insertion point', () => {
    const steps = [set('a'), set('b'), jump(1)];
    const next = insertStep(steps, 0, set('new'));

    // b was 1, is now 2.
    expect(names(next)).toEqual(['new', 'a', 'b', '->2']);
  });

  it('leaves earlier branches alone', () => {
    const steps = [set('a'), jump(0), set('b')];
    const next = insertStep(steps, 2, set('new'));

    expect(names(next)).toEqual(['a', '->0', 'new', 'b']);
  });

  it('clamps an out-of-range position rather than dropping the step', () => {
    const steps = [set('a')];
    expect(insertStep(steps, 99, set('b'))).toHaveLength(2);
  });
});

describe('updateStep', () => {
  it('replaces in place and touches no indices', () => {
    const steps = [set('a'), jump(0)];
    const next = updateStep(steps, 0, set('renamed'));

    expect(names(next)).toEqual(['renamed', '->0']);
  });
});

describe('inspect', () => {
  it('flags a condition whose key nothing above ever sets', () => {
    const problems = inspect([jump(2), set('k')]);

    // The set comes AFTER, so the condition can never pass.
    expect(problems.some((p) => p.message.includes('always takes the else'))).toBe(
      true,
    );
  });

  it('accepts a condition whose key was set above it', () => {
    const problems = inspect([set('k'), jump(2)]);
    expect(problems.filter((p) => p.message.includes('always takes'))).toHaveLength(
      0,
    );
  });

  it('says when a jump goes backwards, without calling it an error', () => {
    const problems = inspect([set('k'), set('x'), jump(0)]);

    // Loops are legal — that is how a retry is built — but worth saying,
    // because dragging steps can create one by accident.
    expect(problems.some((p) => p.message.includes('loop'))).toBe(true);
  });

  it('flags an agent step with no agent chosen', () => {
    const problems = inspect([{ type: 'agent', agentId: '', goal: 'go' }]);
    expect(problems[0]?.message).toContain('Choose an agent');
  });

  it('finds nothing wrong with a sound workflow', () => {
    const problems = inspect([
      set('k'),
      jump(3),
      { type: 'approve', prompt: 'ok?' },
      { type: 'agent', agentId: 'ag_1', goal: 'work' },
    ]);

    expect(problems).toEqual([]);
  });
});

describe('blankStep', () => {
  it('gives a new condition a target that stops rather than loops', () => {
    const step = blankStep('condition', 3);

    /*
     * Past the end, so a half-configured condition ends the run instead of
     * jumping to step 0 — a placeholder that stops is obvious, a placeholder
     * that loops looks like a working workflow.
     */
    expect(step).toMatchObject({ type: 'condition', elseGoto: 4 });
  });

  it('makes every type valid enough to save', () => {
    for (const type of ['agent', 'approve', 'condition', 'set'] as const) {
      expect(blankStep(type, 0).type).toBe(type);
    }
  });
});
