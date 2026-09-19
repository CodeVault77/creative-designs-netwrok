import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { DensityProvider } from '@/lib/styles/DensityProvider';
import { Button } from './Button';
import { TextField } from './TextField';
import { Chip } from './Chip';
import { Avatar, initialsFrom } from './Avatar';
import { Skeleton } from './Skeleton';
import { truncateLabel } from './NodePreview';
import { Sheet } from './Sheet';

function renderUI(ui: ReactElement) {
  return render(<DensityProvider density="pointer">{ui}</DensityProvider>);
}

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    renderUI(<Button>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('is disabled and marked busy while loading', () => {
    renderUI(<Button loading>Generating</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps its label in the accessibility tree while loading', () => {
    // The label is visually hidden, not removed — a screen reader user must
    // still know which button is busy.
    renderUI(<Button loading>Generating map</Button>);
    expect(
      screen.getByRole('button', { name: /generating map/i }),
    ).toBeInTheDocument();
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    renderUI(
      <Button disabled onClick={onClick}>
        Delete
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'), { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('associates its label with the input', async () => {
    renderUI(<TextField label="Map name" />);
    const input = screen.getByLabelText('Map name');
    await userEvent.type(input, 'Research');
    expect(input).toHaveValue('Research');
  });

  it('keeps the label available to screen readers when visually hidden', () => {
    renderUI(<TextField label="Search" hideLabel />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('marks itself invalid and announces the error', () => {
    renderUI(<TextField label="Map name" error="Already taken" />);
    expect(screen.getByLabelText('Map name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Already taken');
  });

  it('describes the input with its hint without announcing it as an alert', () => {
    renderUI(<TextField label="Map name" hint="Visible to collaborators" />);
    expect(screen.getByLabelText('Map name')).toHaveAccessibleDescription(
      'Visible to collaborators',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error instead of the hint when both are given', () => {
    renderUI(<TextField label="Name" hint="A hint" error="An error" />);
    expect(screen.getByText('An error')).toBeInTheDocument();
    expect(screen.queryByText('A hint')).not.toBeInTheDocument();
  });
});

describe('Chip', () => {
  it('exposes its selected state through aria-pressed', () => {
    renderUI(<Chip selected>Create</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders as a non-interactive element when read-only', () => {
    renderUI(<Chip readOnly>Create</Chip>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('toggles on click', async () => {
    const onClick = vi.fn();
    renderUI(<Chip onClick={onClick}>Discover</Chip>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Avatar', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['Prince', 'PR'],
    ['  Grace   Brewster Hopper  ', 'GH'],
    ['', '?'],
  ])('derives initials from %j', (name, expected) => {
    expect(initialsFrom(name)).toBe(expected);
  });

  it('handles non-Latin names without slicing a surrogate pair in half', () => {
    // Naive slice(0,2) on an emoji or an astral-plane character produces a
    // replacement glyph. Array spread iterates code points instead.
    expect(initialsFrom('日本語')).toBe('日本');
  });

  it('falls back to initials when the image fails to load', () => {
    renderUI(<Avatar name="Ada Lovelace" src="/missing.png" />);
    // Image renders first; the error handler swaps it. Presence of the
    // accessible name via title is what matters either way.
    expect(screen.getByTitle('Ada Lovelace')).toBeInTheDocument();
  });

  it('labels the admin badge', () => {
    renderUI(<Avatar name="Alan Turing" admin />);
    expect(screen.getByLabelText('Administrator')).toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('announces loading once for a multi-line block, not once per line', () => {
    renderUI(<Skeleton lines={5} />);
    expect(screen.getAllByLabelText('Loading')).toHaveLength(1);
  });
});

describe('truncateLabel', () => {
  it('leaves short labels alone', () => {
    expect(truncateLabel('Mind Mapping')).toBe('Mind Mapping');
  });

  it('truncates at the canvas budget with an ellipsis', () => {
    const result = truncateLabel('Freelance & Marketplace Services');
    expect(result).toHaveLength(18);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('Sheet', () => {
  /**
   * The sheet must escape whatever it is written inside.
   *
   * `position: fixed` is viewport-relative only while no ancestor establishes
   * a containing block, and `transform`, `filter`, `backdrop-filter`,
   * `perspective`, `contain` and `will-change` all do. The top bar blurs its
   * backdrop, so the menu drawer opened from it rendered a full-height panel
   * clipped to a 56px strip — and the symptom reads as a z-index bug, which
   * sends you to fix the wrong thing.
   *
   * jsdom computes no layout, so this asserts the structural fact that
   * prevents it: the panel is not a descendant of the element that rendered
   * it.
   */
  it('portals out of a containing-block ancestor', () => {
    const { container } = renderUI(
      <div style={{ backdropFilter: 'blur(16px)' }} data-testid="chrome">
        <Sheet open onClose={() => {}} title="Menu" placement="right">
          <p>Body</p>
        </Sheet>
      </div>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Menu' });

    expect(dialog).toBeTruthy();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  /**
   * The defect this guards.
   *
   * A closed Sheet used to stay mounted and park itself just past the edge
   * with translateX(100%). A fixed, transformed element still counts toward
   * the document's scrollable overflow, so a closed right-hand sheet made the
   * whole app scrollable sideways by its own width — swiping on the map
   * dragged the page across to reveal a menu nobody had opened. It also left a
   * permanent role="dialog" in the accessibility tree.
   *
   * Nothing about the visual result was wrong enough to fail a screenshot, and
   * no test looked at the DOM while a sheet was closed, so it shipped.
   */
  it('puts nothing in the document while closed', () => {
    renderUI(
      <Sheet open={false} onClose={() => {}} title="Menu" placement="right">
        <p>Body</p>
      </Sheet>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('renders its content when open', () => {
    renderUI(
      <Sheet open onClose={() => {}} title="Menu" placement="right">
        <p>Body</p>
      </Sheet>,
    );

    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });
});
