# SQLite migration baseline

`0001_init.sql` is a single-shot DDL snapshot of `prisma/schema.sqlite.prisma`. It is **reference-only**: the actual schema is applied via `npm run db:migrate:sqlite` (which uses `prisma db push`, not migration history). The baseline exists so reviewers can see what the SQLite schema produces without spinning up a database.

## When to regenerate

Whenever `prisma/schema.sqlite.prisma` changes.

## How to regenerate

Run from `packages/db/`.

### PowerShell (Windows)

```powershell
# 1. (Optional) Verify the schema applies cleanly on a fresh SQLite file.
Remove-Item -Force -ErrorAction SilentlyContinue .\tmp-verify.sqlite
$env:DATABASE_URL = "file:./tmp-verify.sqlite"
npm run db:migrate:sqlite

# 2. Snapshot the DDL into the reference baseline.
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.sqlite.prisma --script | Out-File -Encoding utf8 prisma/migrations-sqlite/0001_init.sql

# 3. Cleanup.
Remove-Item -Force -ErrorAction SilentlyContinue .\tmp-verify.sqlite
Remove-Item Env:DATABASE_URL
```

### bash (macOS / Linux / WSL)

```bash
# 1. (Optional) Verify the schema applies cleanly on a fresh SQLite file.
rm -f tmp-verify.sqlite
DATABASE_URL="file:./tmp-verify.sqlite" npm run db:migrate:sqlite

# 2. Snapshot the DDL into the reference baseline.
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.sqlite.prisma \
  --script \
  > prisma/migrations-sqlite/0001_init.sql

# 3. Cleanup.
rm -f tmp-verify.sqlite
```

## Why not `prisma migrate dev`?

Prisma's `migrate dev` derives its migrations directory from the schema file's location, which would collide with `prisma/migrations/` (the Postgres production history). The desktop SQLite track is dev-only, so a `db push` workflow plus a snapshot SQL file gives us reproducibility without a parallel migration-history regime to maintain.

See `DESKTOP_SPRINT_PLAN.md` D1 Sprint 2 and `docs/D1_S1_SCHEMA_AUDIT.md` for the design rationale.

## Note on Json defaults

Prisma 6.x emits `Json @default("...")` values on SQLite as raw literals without SQL quoting, which SQLite rejects. The SQLite schema wraps every Json default in `dbgenerated("'...'")` so the SQL string literal is preserved through to the generated DDL. Mirror this pattern whenever you add a new Json column with a non-null default.
