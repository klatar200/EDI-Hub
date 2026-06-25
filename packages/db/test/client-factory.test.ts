/**
 * Desktop track D1 Sprint 2.4 — provider resolution unit tests.
 *
 * The factory's `resolveProvider` is the pure surface we can test without
 * instantiating Prisma. `getPrisma` itself relies on the SQLite generated
 * client at `node_modules/.prisma/client-sqlite`, which is only present if
 * `db:generate:sqlite` has been run — that side is covered by the integration
 * step in D1 Sprint 4.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, type DatabaseProvider } from '../src/client-factory.js';

test('resolveProvider defaults to postgresql when DATABASE_PROVIDER is unset', () => {
  const got = resolveProvider({});
  assert.equal(got, 'postgresql');
});

test('resolveProvider defaults to postgresql when DATABASE_PROVIDER is empty', () => {
  assert.equal(resolveProvider({ DATABASE_PROVIDER: '' }), 'postgresql');
});

test('resolveProvider returns sqlite for DATABASE_PROVIDER=sqlite', () => {
  assert.equal(resolveProvider({ DATABASE_PROVIDER: 'sqlite' }), 'sqlite');
});

test('resolveProvider is case-insensitive', () => {
  assert.equal(resolveProvider({ DATABASE_PROVIDER: 'SQLite' }), 'sqlite');
  assert.equal(resolveProvider({ DATABASE_PROVIDER: 'POSTGRESQL' }), 'postgresql');
});

test('resolveProvider accepts postgres as an alias for postgresql', () => {
  assert.equal(resolveProvider({ DATABASE_PROVIDER: 'postgres' }), 'postgresql');
});

test('resolveProvider trims surrounding whitespace', () => {
  assert.equal(resolveProvider({ DATABASE_PROVIDER: '  sqlite  ' }), 'sqlite');
});

test('resolveProvider throws on an unsupported value', () => {
  assert.throws(
    () => resolveProvider({ DATABASE_PROVIDER: 'mysql' }),
    /Unsupported DATABASE_PROVIDER='mysql'/,
  );
});

test('resolveProvider return type is the documented union', () => {
  // Compile-time check that consumers can narrow on the return value.
  const got: DatabaseProvider = resolveProvider({ DATABASE_PROVIDER: 'sqlite' });
  assert.ok(got === 'sqlite' || got === 'postgresql');
});
