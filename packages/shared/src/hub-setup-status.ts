/**
 * U5/O2 — tenant-level hub setup completeness (partner, ISA IDs, channel, ingest).
 */
export interface HubSetupCheck {
  id: 'partner' | 'ourIsaIds' | 'channel' | 'ingest';
  label: string;
  ok: boolean;
  /** Route to fix this gap. */
  to: string;
}

export interface HubSetupStatusResult {
  checks: HubSetupCheck[];
  doneCount: number;
  total: number;
  complete: boolean;
}

/** Compute hub-wide setup progress for the persistent header indicator. */
export function hubSetupStatus(input: {
  partnersWithIsa: number;
  ourIsaIds: readonly string[];
  channelCount: number;
  hasIngested: boolean;
}): HubSetupStatusResult {
  const checks: HubSetupCheck[] = [
    {
      id: 'partner',
      label: 'Trading partner',
      ok: input.partnersWithIsa > 0,
      to: '/partners-config',
    },
    {
      id: 'ourIsaIds',
      label: 'Your ISA IDs',
      ok: input.ourIsaIds.length > 0,
      to: '/settings',
    },
    {
      id: 'channel',
      label: 'Ingestion channel',
      ok: input.channelCount > 0,
      to: '/channels',
    },
    {
      id: 'ingest',
      label: 'First file ingested',
      ok: input.hasIngested,
      to: '/documents?view=raw',
    },
  ];
  const doneCount = checks.filter((c) => c.ok).length;
  return {
    checks,
    doneCount,
    total: checks.length,
    complete: doneCount === checks.length,
  };
}
