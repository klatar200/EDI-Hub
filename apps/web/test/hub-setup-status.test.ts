import { test, expect } from 'vitest';
import { hubSetupStatus } from '@edi/shared';

test('hubSetupStatus counts four setup checks', () => {
  const empty = hubSetupStatus({
    partnersWithIsa: 0,
    ourIsaIds: [],
    channelCount: 0,
    hasIngested: false,
  });
  expect(empty.total).toBe(4);
  expect(empty.doneCount).toBe(0);
  expect(empty.complete).toBe(false);

  const done = hubSetupStatus({
    partnersWithIsa: 2,
    ourIsaIds: ['SENDER'],
    channelCount: 1,
    hasIngested: true,
  });
  expect(done.doneCount).toBe(4);
  expect(done.complete).toBe(true);
});

test('hubSetupStatus links each gap to a fix route', () => {
  const status = hubSetupStatus({
    partnersWithIsa: 0,
    ourIsaIds: ['ME'],
    channelCount: 0,
    hasIngested: false,
  });
  expect(status.checks.find((c) => c.id === 'partner')?.to).toBe('/partners-config');
  expect(status.checks.find((c) => c.id === 'ourIsaIds')?.to).toBe('/settings');
  expect(status.checks.find((c) => c.id === 'channel')?.to).toBe('/channels');
  expect(status.checks.find((c) => c.id === 'ingest')?.to).toBe('/documents?view=raw');
});
