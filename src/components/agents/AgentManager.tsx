'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import {
  Button,
  Card,
  Checkbox,
  TextField,
  Textarea,
  useToast,
} from '@/components/ui';

/**
 * Agent management.
 *
 * â”€â”€ What this screen is really for â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Not creating agents â€” that is one form. It exists so the person responsible
 * for an agent can see what it is allowed to do and what it has been doing,
 * and stop it. Every control that narrows an agent is on the first screen; the
 * things that widen one are the ones that take deliberate clicks.
 *
 * â”€â”€ Refused steps are shown, not hidden â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * A rising refusal count means an agent is repeatedly reaching for tools it
 * does not hold, which is either a misconfiguration or something steering it.
 * Surfacing it beside the run count is the difference between noticing that in
 * an afternoon and noticing it in an invoice.
 */

export interface AgentSummary {
  id: string;
  nodeId: string;
  name: string;
  instructions: string;
  enabled: boolean;
  monthlyUsd: number;
  maxSteps: number;
  tools: string[];
}

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
`;

const Name = styled.h2`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

/**
 * Paused reads as a state, not a decoration.
 *
 * Â§10's rule about two channels applies here too: the pill changes colour AND
 * says the word, so "is this agent running" is never a matter of noticing a
 * hue.
 */
const State = styled.span<{ $on: boolean }>`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: var(--radius-chip);
  border: 1px solid
    ${({ $on }) => ($on ? 'var(--fam-create-core)' : 'var(--ground-border)')};
  color: ${({ $on }) => ($on ? 'var(--fam-create-core)' : 'var(--ground-muted)')};
`;

const Meta = styled.p`
  margin: var(--space-2) 0 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Tools = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
`;

const Empty = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

export interface AgentManagerProps {
  mapId: string;
  /** Nodes that could host a new agent. */
  nodes: { id: string; title: string }[];
  canManage: boolean;
}

export function AgentManager({ mapId, nodes, canManage }: AgentManagerProps) {
  const toast = useToast();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [instructions, setInstructions] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`/api/agents?mapId=${encodeURIComponent(mapId)}`);
    if (!response.ok) {
      setLoading(false);
      return;
    }
    const body = (await response.json()) as {
      agents: AgentSummary[];
      tools: string[];
    };
    setAgents(body.agents);
    setTools(body.tools);
    setLoading(false);
  }, [mapId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (agentId: string, body: Record<string, unknown>) => {
      setBusy(agentId);
      try {
        const response = await fetch(`/api/agents/${agentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          toast.show({ tone: 'danger', message: 'That did not work.' });
          return;
        }
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load, toast],
  );

  const create = useCallback(async () => {
    if (!name.trim() || !nodeId) return;

    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId, name, instructions }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      toast.show({ tone: 'danger', message: body.error ?? 'That did not work.' });
      return;
    }

    setName('');
    setInstructions('');
    await load();
    toast.show({ tone: 'success', message: 'Agent created with no tools.' });
  }, [name, nodeId, instructions, load, toast]);

  const run = useCallback(
    async (agentId: string) => {
      setBusy(agentId);
      try {
        const response = await fetch(`/api/agents/${agentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: 'Do what you were set up to do.' }),
        });

        const body = (await response.json().catch(() => ({}))) as {
          run?: { status: string; steps: number; error?: string };
        };

        /*
         * The outcome is reported plainly, including a refusal.
         *
         * "Nothing happened" is the worst possible feedback for an agent: the
         * user cannot tell a refusal from a crash from an agent that decided
         * to do nothing, and all three need different responses.
         */
        const status = body.run?.status ?? 'failed';
        toast.show({
          tone: status === 'ok' ? 'success' : 'danger',
          message:
            status === 'ok'
              ? `Finished in ${body.run?.steps ?? 0} steps.`
              : (body.run?.error ?? 'The run did not finish.'),
        });
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  if (loading) return <Empty>Loadingâ€¦</Empty>;

  return (
    <>
      {canManage && (
        <Card style={{ marginBottom: 'var(--space-8)' }}>
          <h2 style={{ marginTop: 0 }}>New agent</h2>

          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint="What this agent is for."
          />

          <div style={{ marginTop: 'var(--space-4)' }}>
            <label
              htmlFor="agent-node"
              style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-label)',
                color: 'var(--ground-muted)',
              }}
            >
              On which node
            </label>
            <select
              id="agent-node"
              value={nodeId}
              onChange={(event) => setNodeId(event.target.value)}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0 var(--space-3)',
                background: 'var(--ground-raised)',
                border: '1px solid var(--ground-border)',
                borderRadius: 'var(--radius-control)',
                color: 'var(--ground-ink)',
              }}
            >
              <option value="">Choose a node</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <Textarea
              label="Instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              hint="What it should do, and what it should not."
              rows={4}
              maxLength={4000}
            />
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button onClick={create} disabled={!name.trim() || !nodeId}>
              Create agent
            </Button>
          </div>

          {/*
            Said at the point of creation, because it is the single most
            important fact about a new agent and the least obvious.
          */}
          <Meta>
            A new agent has no tools and can do nothing until you grant some.
          </Meta>
        </Card>
      )}

      {agents.length === 0 ? (
        <Empty>No agents on this map yet.</Empty>
      ) : (
        <List>
          {agents.map((agent) => (
            <li key={agent.id}>
              <Card>
                <Head>
                  <Name>{agent.name}</Name>
                  <State $on={agent.enabled}>
                    {agent.enabled ? 'RUNNING' : 'PAUSED'}
                  </State>
                </Head>

                <Meta>
                  {agent.tools.length === 0
                    ? 'No tools â€” this agent cannot do anything'
                    : `${agent.tools.length} tools`}
                  {' Â· '}
                  {`$${agent.monthlyUsd.toFixed(2)}/month`}
                  {' Â· '}
                  {`${agent.maxSteps} steps max`}
                </Meta>

                {canManage && (
                  <Tools>
                    {tools.map((tool) => {
                      const held = agent.tools.includes(tool);
                      return (
                        <Checkbox
                          key={tool}
                          label={tool}
                          checked={held}
                          disabled={busy === agent.id}
                          onChange={() =>
                            patch(
                              agent.id,
                              held ? { revokeTool: tool } : { grantTool: tool },
                            )
                          }
                        />
                      );
                    })}
                  </Tools>
                )}

                <Actions>
                  <Button
                    variant="secondary"
                    disabled={busy === agent.id}
                    onClick={() => run(agent.id)}
                  >
                    Run now
                  </Button>

                  {canManage && (
                    <Button
                      variant="secondary"
                      disabled={busy === agent.id}
                      onClick={() => patch(agent.id, { enabled: !agent.enabled })}
                    >
                      {agent.enabled ? 'Pause' : 'Resume'}
                    </Button>
                  )}
                </Actions>
              </Card>
            </li>
          ))}
        </List>
      )}
    </>
  );
}
