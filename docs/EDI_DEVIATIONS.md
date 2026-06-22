# Real-world EDI deviations — what Phase 2 parsing must survive

Trading-partner EDI rarely matches the textbook. This catalog records the
deviations the hub must tolerate. During Phase 1 we ingest and store everything
verbatim (the raw file is sacred) and only read the ISA/GS envelope; the items
below become the **fixture library** that Phase 2's full segment/element parser
is tested against.

> Sprint 3 ships synthetic fixtures for the cases that affect *ingestion*
> (empty, non-X12, malformed ISA). The structural deviations below are logged
> here now so Phase 2 starts with a known list rather than discovering them in
> production. Replace/augment with real (anonymized) partner samples once data
> rights are confirmed (BUILD_PLAN §10).

## Delimiter / envelope deviations
- **Non-standard delimiters.** Element separator may be `*`, `|`, `^`, etc.;
  sub-element `:`, `>`, `\`; segment terminator `~`, `\n`, `\r\n`, or a control
  char like RS (`0x1e`). Never hardcode — read them from the ISA segment
  (`extractEnvelopeIds` already does this).
- **Line-wrapped segments.** Some partners put each segment on its own line
  (terminator `~` *plus* CRLF); others send one long line. Trim around the
  terminator.
- **Leading bytes before ISA.** UTF-8 BOM or stray whitespace/newlines before
  `ISA`. We tolerate up to a small offset.
- **ISA padding.** ISA fields are fixed-width and space-padded; values must be
  trimmed (`SENDER         ` -> `SENDER`).
- **4010 vs 5010.** ISA11 is the standards id `U` in 4010 but a repetition
  separator in 5010. Surface the version from GS08; don't assume.

## Structural deviations (Phase 2 parser concerns)
- **Batched interchanges.** Multiple `GS/GE` groups in one ISA, and multiple
  `ST/SE` transactions in one group. One file can hold many business documents.
- **Missing optional segments.** Spec-optional segments (DTM, REF, N1 loops)
  routinely absent. Absence is not an error.
- **Repeated "non-repeating" segments.** Partners repeat segments the spec marks
  as max-use 1. Parse defensively.
- **Proprietary Z-segments.** Partner-specific segments (e.g. `ZZ`, `ZA`) not in
  the standard. Preserve them; don't crash.
- **Out-of-order or extra elements.** Trailing empty elements, extra
  sub-elements. Index by position but bounds-check every access.
- **Control-number quirks.** ISA13 may collide across partners; dedup is on ISA13
  but partner identity (ISA06/ISA08) may be needed to disambiguate later.

## Ingestion-level failure inputs (covered now, Sprint 3)
| Input | Behaviour |
|---|---|
| Empty file | `400 EMPTY_FILE`, nothing stored |
| Not X12 at all (PDF, text) | stored raw, `UNRECOGNIZED_FORMAT`, no dedup |
| ISA present but unparseable | stored raw, `PARSE_ERROR`, no dedup |
| Oversized (> max file size) | `413 FILE_TOO_LARGE` |
| S3 unreachable | `503 STORAGE_UNAVAILABLE`, no DB row |
| DB unreachable | `503 DB_UNAVAILABLE`, no S3 write (fail fast) |

## Open questions to resolve with real data (Phase 2 inputs)
1. Actual delimiters used by each pilot partner (record ISA[3], ISA[16], terminator).
2. Are files raw X12 or wrapped by an ERP/VAN layer needing an unwrap step?
3. Typical and max file sizes (affects buffer vs. stream decisions).
4. One transaction per file, or batched (multiple ST/SE per ISA)?
5. Any partners known to send Z-segments or other non-spec structures?
