/**
 * Desktop track D1 Sprint 3 — String[] ↔ JSON-string serialization.
 *
 * SQLite has no native array type. The four `String[]` columns on `Tenant`
 * and `TradingPartner` (audit list in D1_S1_SCHEMA_AUDIT.md §3) are stored
 * as JSON-serialised TEXT on the SQLite schema and read/written as JS arrays
 * by the API code. This module provides the pure transform helpers; the
 * tenant extension calls them automatically when the active provider is
 * SQLite. On Postgres the helpers are never invoked — the schema keeps the
 * native `String[]` type and Prisma handles arrays end-to-end.
 *
 * Design notes:
 *   - The helpers are pure and recursive: they walk `data` / `result` shapes
 *     Prisma actually emits (single objects, `createMany` arrays, `findMany`
 *     results, Prisma's `{ set: [...] }` update form). Unknown shapes pass
 *     through unchanged so e.g. `count` and `aggregate` results survive.
 *   - The model-to-field map is hand-maintained. Adding a fifth `String[]`
 *     column means adding it here (and to `schema.sqlite.prisma` of course).
 *     The unit tests assert the documented set so regressions surface fast.
 *   - We do NOT recurse into nested relation creates (e.g. a Tenant create
 *     with `tradingPartners: { create: [...] }`). Today no code path does
 *     this — partner creation always goes through the partner route. If that
 *     ever changes, mirror the relation-walking pattern from `injectInData`
 *     in `tenant-extension.ts`.
 */

/**
 * The four `String[]` columns that flip to JSON-encoded TEXT on SQLite.
 * Keep in lock-step with `schema.sqlite.prisma`. The array-serialization
 * unit test asserts this exact shape.
 */
export const ARRAY_FIELDS_BY_MODEL: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  Tenant: Object.freeze(['ourIsaIds']),
  TradingPartner: Object.freeze([
    'isaSenderIds',
    'isaReceiverIds',
    'supportedSets',
  ]),
} as Record<string, ReadonlyArray<string>>);

function fieldsFor(model: string): ReadonlyArray<string> | undefined {
  return ARRAY_FIELDS_BY_MODEL[model];
}

/**
 * Walk a write `data` payload and JSON-stringify any array values on the
 * known fields. Pure: returns a shallow-cloned object (the original is not
 * mutated, since Prisma can reuse the args object internally).
 *
 * Handles:
 *   - single objects: `{ ourIsaIds: ['A'] }` → `{ ourIsaIds: '["A"]' }`
 *   - arrays (`createMany.data`): `[{...}, {...}]`
 *   - Prisma's `{ set: [...] }` update form: `{ ourIsaIds: { set: ['A'] } }`
 *     → `{ ourIsaIds: '["A"]' }`
 *
 * Passes through null/undefined, primitives, and unknown shapes unchanged.
 */
export function serializeArrayFields(model: string, data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.map((d) => serializeArrayFields(model, d));
  }
  if (typeof data !== 'object') return data;
  const fields = fieldsFor(model);
  if (!fields) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of fields) {
    const v = out[field];
    if (Array.isArray(v)) {
      out[field] = JSON.stringify(v);
      continue;
    }
    if (v && typeof v === 'object' && 'set' in v) {
      const setOp = (v as { set: unknown }).set;
      if (Array.isArray(setOp)) {
        out[field] = JSON.stringify(setOp);
      }
    }
  }
  return out;
}

/**
 * Walk a Prisma query `result` and JSON-parse any string values on the
 * known fields back into JS arrays. Pure: returns a shallow-cloned object;
 * unknown shapes pass through.
 *
 * Handles:
 *   - single row objects (findUnique/findFirst/create/update/delete)
 *   - row arrays (findMany/createManyAndReturn)
 *   - null (findUnique miss)
 *   - primitives (count, etc.) — passed through
 *
 * If a field value is a non-JSON string (or a string that doesn't decode
 * to an array), it is left untouched so the calling code surfaces a real
 * shape error instead of getting a silently-wrong value.
 */
export function deserializeArrayFields(model: string, row: unknown): unknown {
  if (row == null) return row;
  if (Array.isArray(row)) {
    return row.map((r) => deserializeArrayFields(model, r));
  }
  if (typeof row !== 'object') return row;
  const fields = fieldsFor(model);
  if (!fields) return row;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of fields) {
    const v = out[field];
    if (typeof v !== 'string') continue;
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) out[field] = parsed;
    } catch {
      // Leave as-is so downstream sees the raw value and the test/log shows
      // a real "expected array, got string" error rather than a silent fix.
    }
  }
  return out;
}
