'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, TextField, useToast } from '@/components/ui';
import type { Step } from '@/lib/agents/workflows';
import {
  blankStep,
  insertStep,
  inspect,
  moveStep,
  removeStep,
  updateStep,
} from '@/lib/agents/steps';

/**
 * The visual workflow builder.
 *
 * ── Drag is an addition, never the only way ─────────────────────────────────
 *
 * Every step has Move up and Move down buttons, and dragging is layered on top
 * of them. That order matters: HTML5 drag-and-drop is invisible to a keyboard
 * and to a screen reader, so a builder that only supported dragging would be a
 * feature some people simply cannot use. The buttons are the real control; the
 * drag is a shortcut for people with a pointer.
 *
 * ── Reordering remaps the branches ──────────────────────────────────────────
 *
 * A condition jumps to an absolute index, so moving a step changes what every
 * jump refers to. All four list operations go through `lib/agents/steps`,
 * which remaps targets through the same permutation it applies to the steps —
 * otherwise dragging silently reroutes a branch, and nothing tells you.
 *
 * ── Warnings are not errors ─────────────────────────────────────────────────
 *
 * `inspect` reports things that are valid to save and probably wrong: a jump
 * with nothing setting its key, an accidental backwards loop. They never block
 * saving, because the author knows things the checker does not.
 */

export interface WorkflowSummary {
  id: string;
  name: string;
  trigger: 'manual' | 'event';
  triggerOn: string | null;
  enabled: boolean;
  steps: Step[];
}

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
`;

const StepList = styled.ol`
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const StepItem = styled.li<{ $dragging: boolean; $over: boolean }>`
  padding: var(--space-3);
  border: 1px solid
    ${({ $over }) => ($over ? 'var(--color-focus)' : 'var(--ground-border)')};
  border-radius: var(--radius-card);
  background: var(--ground-surface);
  opacity: ${({ $dragging }) => ($dragging ? 0.4 : 1)};
`;

const StepHead = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
`;

const Index = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  min-width: 2ch;
`;

const Kind = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fam-create-core);
`;

const Spacer = styled.span`
  flex: 1;
`;

/** A small square control; several sit in a row and must stay tappable. */
const Tiny = styled.button`
  min-width: 36px;
  min-height: 36px;
  padding: 0 var(--space-2);
  background: none;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-muted);
  font: inherit;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--ground-ink);
    border-color: var(--ground-ink);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const Fields = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-3);
`;

const Field = styled.div`
  flex: 1 1 12rem;
  min-width: 0;
`;

const Warning = styled.p`
  margin: var(--space-2) 0 0;
  font-size: var(--text-caption);
  color: var(--color-warning);
  line-height: 1.5;
`;

const Muted = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Label = styled.label`
  display: block;
  margin-bottom: var(--space-2);
  font-size: var(--text-label);
  color: var(--ground-muted);
`;

const NativeSelect = styled.select`
  width: 100%;
  min-height: 44px;
  padding: 0 var(--space-3);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font: inherit;
`;

const STEP_TYPES: { value: Step['type']; label: string }[] = [
  { value: 'agent', label: 'Run an agent' },
  { value: 'approve', label: 'Wait for approval' },
  { value: 'condition', label: 'Branch on a value' },
  { value: 'set', label: 'Set a value' },
];

export interface WorkflowBuilderProps {
  mapId: string;
  agents: { id: string; name: string }[];
  canManage: boolean;
}

export function WorkflowBuilder({
  mapId,
  agents,
  canManage,
}: WorkflowBuilderProps) {
  const toast = useToast();

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<'manual' | 'event'>('manual');
  const [triggerOn, setTriggerOn] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);

  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const problems = useMemo(() => inspect(steps), [steps]);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/workflows?mapId=${encodeURIComponent(mapId)}`,
    );
    if (response.ok) {
      const body = (await response.json()) as {
        workflows: WorkflowSummary[];
        triggerableEvents: string[];
      };
      setWorkflows(body.workflows);
      setEvents(body.triggerableEvents);
    }
    setLoading(false);
  }, [mapId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = useCallback(() => {
    setEditingId(null);
    setName('');
    setTrigger('manual');
    setTriggerOn('');
    setSteps([]);
  }, []);

  const edit = useCallback((workflow: WorkflowSummary) => {
    setEditingId(workflow.id);
    setName(workflow.name);
    setTrigger(workflow.trigger);
    setTriggerOn(workflow.triggerOn ?? '');
    setSteps(workflow.steps);
  }, []);

  const save = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);

    try {
      const body = {
        name,
        steps,
        trigger,
        /*
         * Explicitly null when switching back to manual, so the stored event
         * name is cleared. Leaving it would keep the workflow matching an
         * event trigger query it is no longer supposed to answer.
         */
        triggerOn: trigger === 'event' ? triggerOn : null,
        ...(editingId ? {} : { mapId }),
      };

      const response = await fetch(
        editingId ? `/api/workflows/${editingId}` : '/api/workflows',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.show({
          tone: 'danger',
          message: failure.error ?? 'That did not save.',
        });
        return;
      }

      reset();
      await load();
      toast.show({ tone: 'success', message: 'Saved.' });
    } finally {
      setBusy(false);
    }
  }, [name, steps, trigger, triggerOn, editingId, mapId, reset, load, toast]);

  const run = useCallback(
    async (workflowId: string) => {
      const response = await fetch('/api/workflows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId }),
      });

      toast.show({
        tone: response.ok ? 'success' : 'danger',
        message: response.ok
          ? 'Started. Steps run in the background.'
          : 'That workflow could not start.',
      });
    },
    [toast],
  );

  const remove = useCallback(
    async (workflowId: string) => {
      await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' });
      if (editingId === workflowId) reset();
      await load();
    },
    [editingId, reset, load],
  );

  /** All four list edits go through the remapping helpers, never splice. */
  const move = (from: number, to: number) => setSteps((s) => moveStep(s, from, to));

  if (loading) return <Muted>Loading…</Muted>;

  return (
    <>
      {canManage && (
        <Card style={{ marginBottom: 'var(--space-8)' }}>
          <h2 style={{ marginTop: 0 }}>
            {editingId ? 'Edit workflow' : 'New workflow'}
          </h2>

          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <Fields>
            <Field>
              <Label htmlFor="wf-trigger">Starts</Label>
              <NativeSelect
                id="wf-trigger"
                value={trigger}
                onChange={(event) =>
                  setTrigger(event.target.value as 'manual' | 'event')
                }
              >
                <option value="manual">When someone presses Run</option>
                <option value="event">When something happens</option>
              </NativeSelect>
            </Field>

            {trigger === 'event' && (
              <Field>
                <Label htmlFor="wf-event">On</Label>
                <NativeSelect
                  id="wf-event"
                  value={triggerOn}
                  onChange={(event) => setTriggerOn(event.target.value)}
                >
                  <option value="">Choose an event</option>
                  {events.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {eventType}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </Fields>

          <StepList>
            {steps.map((step, index) => {
              const stepProblems = problems.filter((p) => p.index === index);

              return (
                <StepItem
                  key={index}
                  $dragging={dragging === index}
                  $over={over === index && dragging !== index}
                  draggable
                  onDragStart={() => setDragging(index)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOver(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging !== null) move(dragging, index);
                    setDragging(null);
                    setOver(null);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <StepHead>
                    <Index>{index}</Index>
                    <Kind>{step.type}</Kind>
                    <Spacer />

                    {/*
                      The keyboard path. These are the real reorder control —
                      dragging is the shortcut layered over them.
                    */}
                    <Tiny
                      type="button"
                      aria-label={`Move step ${index} up`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑
                    </Tiny>
                    <Tiny
                      type="button"
                      aria-label={`Move step ${index} down`}
                      disabled={index === steps.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓
                    </Tiny>
                    <Tiny
                      type="button"
                      aria-label={`Remove step ${index}`}
                      onClick={() => setSteps((s) => removeStep(s, index))}
                    >
                      ✕
                    </Tiny>
                  </StepHead>

                  {step.type === 'agent' && (
                    <Fields>
                      <Field>
                        <Label htmlFor={`step-${index}-agent`}>Agent</Label>
                        <NativeSelect
                          id={`step-${index}-agent`}
                          value={step.agentId}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                agentId: event.target.value,
                              }),
                            )
                          }
                        >
                          <option value="">Choose an agent</option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <TextField
                          label="Goal"
                          value={step.goal}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                goal: event.target.value,
                              }),
                            )
                          }
                        />
                      </Field>
                    </Fields>
                  )}

                  {step.type === 'approve' && (
                    <Fields>
                      <Field>
                        <TextField
                          label="Ask"
                          value={step.prompt}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                prompt: event.target.value,
                              }),
                            )
                          }
                        />
                      </Field>
                    </Fields>
                  )}

                  {step.type === 'set' && (
                    <Fields>
                      <Field>
                        <TextField
                          label="Key"
                          value={step.key}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                key: event.target.value,
                              }),
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <TextField
                          label="Value"
                          value={step.value}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                value: event.target.value,
                              }),
                            )
                          }
                        />
                      </Field>
                    </Fields>
                  )}

                  {step.type === 'condition' && (
                    <Fields>
                      <Field>
                        <TextField
                          label="If key"
                          value={step.key}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                key: event.target.value,
                              }),
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <TextField
                          label="Equals"
                          value={step.equals}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                equals: event.target.value,
                              }),
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <Label htmlFor={`step-${index}-goto`}>
                          Otherwise go to
                        </Label>
                        <NativeSelect
                          id={`step-${index}-goto`}
                          value={String(step.elseGoto)}
                          onChange={(event) =>
                            setSteps((s) =>
                              updateStep(s, index, {
                                ...step,
                                elseGoto: Number(event.target.value),
                              }),
                            )
                          }
                        >
                          {steps.map((_, target) => (
                            <option key={target} value={target}>
                              Step {target}
                            </option>
                          ))}
                          {/* Past the end stops the run, which the engine
                              already treats as finished. */}
                          <option value={steps.length}>Stop here</option>
                        </NativeSelect>
                      </Field>
                    </Fields>
                  )}

                  {stepProblems.map((problem) => (
                    <Warning key={problem.message}>{problem.message}</Warning>
                  ))}
                </StepItem>
              );
            })}
          </StepList>

          <Row style={{ marginTop: 'var(--space-4)' }}>
            {STEP_TYPES.map((type) => (
              <Button
                key={type.value}
                variant="secondary"
                onClick={() =>
                  setSteps((s) =>
                    insertStep(s, s.length, blankStep(type.value, s.length)),
                  )
                }
              >
                + {type.label}
              </Button>
            ))}
          </Row>

          <Row style={{ marginTop: 'var(--space-6)' }}>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {editingId ? 'Save changes' : 'Create workflow'}
            </Button>
            {editingId && (
              <Button variant="secondary" onClick={reset}>
                Cancel
              </Button>
            )}
          </Row>
        </Card>
      )}

      <h2 style={{ fontSize: 'var(--text-title)' }}>Workflows</h2>

      {workflows.length === 0 ? (
        <Muted>No workflows on this map yet.</Muted>
      ) : (
        <StepList>
          {workflows.map((workflow) => (
            <StepItem key={workflow.id} $dragging={false} $over={false}>
              <StepHead>
                <strong>{workflow.name}</strong>
                <Kind>
                  {workflow.trigger === 'event'
                    ? `on ${workflow.triggerOn ?? '—'}`
                    : 'manual'}
                </Kind>
                <Spacer />
                <Index>{workflow.steps.length} steps</Index>
              </StepHead>

              <Row style={{ marginTop: 'var(--space-3)' }}>
                <Button variant="secondary" onClick={() => run(workflow.id)}>
                  Run
                </Button>
                {canManage && (
                  <>
                    <Button variant="secondary" onClick={() => edit(workflow)}>
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => remove(workflow.id)}>
                      Delete
                    </Button>
                  </>
                )}
              </Row>
            </StepItem>
          ))}
        </StepList>
      )}
    </>
  );
}
