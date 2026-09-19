import { describe, expect, it, beforeEach } from 'vitest';
import {
  track,
  identify,
  setAnalyticsProvider,
  ANALYTICS_EVENTS,
  type AnalyticsProvider,
} from './index';

function recordingProvider() {
  const calls: Array<{ event: string; properties: unknown }> = [];
  const provider: AnalyticsProvider = {
    name: 'recording',
    track: (event, properties) => calls.push({ event, properties }),
    identify: () => {},
    reset: () => {},
  };
  return { provider, calls };
}

describe('analytics taxonomy', () => {
  it('declares a unique name for every event', () => {
    const unique = new Set<string>(ANALYTICS_EVENTS);
    expect(unique.size).toBe(ANALYTICS_EVENTS.length);
  });

  it('names every event in object_verb form, snake_case', () => {
    for (const event of ANALYTICS_EVENTS) {
      expect(event, `"${event}" is not snake_case`).toMatch(
        /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/,
      );
    }
  });

  it('covers the metrics section 24 measures success by', () => {
    // If any of these are removed, the MVP cannot be evaluated against §24.
    const required = [
      'destination_reached',
      'map_created',
      'map_shared',
      'coming_soon_interest_registered',
      'service_enquiry_submitted',
    ];
    for (const event of required) {
      expect(ANALYTICS_EVENTS).toContain(event);
    }
  });
});

describe('track()', () => {
  beforeEach(() => {
    setAnalyticsProvider({
      name: 'noop',
      track: () => {},
      identify: () => {},
      reset: () => {},
    });
  });

  it('forwards the event and properties to the active provider', () => {
    const { provider, calls } = recordingProvider();
    setAnalyticsProvider(provider);

    track('node_selected', {
      node_id: 'abc',
      family: 'create',
      status: 'active',
      depth: 1,
      surface: 'community',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.event).toBe('node_selected');
    expect(calls[0]?.properties).toMatchObject({ node_id: 'abc', depth: 1 });
  });

  it('never throws when the provider fails', () => {
    setAnalyticsProvider({
      name: 'broken',
      track: () => {
        throw new Error('sink unreachable');
      },
      identify: () => {
        throw new Error('sink unreachable');
      },
      reset: () => {},
    });

    expect(() => track('map_recentred', { surface: 'community' })).not.toThrow();
    expect(() => identify('user-1')).not.toThrow();
  });
});
