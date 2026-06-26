# EDI test file catalog

## Synthetic lifecycles (use these for drop-folder testing)

### US Foods — `lifecycles/us-foods/`

Pipe (`|`) delimiters, CRLF segments, BEG/SA, BAK/**AP**, per-pound PP pricing on 855.

| Group | Synthetic PO | Mirrors production | Files |
|-------|--------------|-------------------|-------|
| group-1 | `7599901Q` | `7535299Q` (Spokane) | 850 → 855 → 810 |
| group-2 | `7599902F` | `7736663F` (Minnesota) | 850 → 855 → 810 |
| group-3 | `7599903Q` | `7745269Q` (Spokane, 108 cs) | 850 → 855 → 810 |

ISA: buyer `621418185` (US Foods) → vendor `7085892400`

### Sysco — `lifecycles/sysco/`

Pipe delimiters, BEG/**NE**, BAK/**AC** + ACK segment, REF/FOB/SAC patterns.

| Group | Synthetic PO | Mirrors production | Pattern |
|-------|--------------|-------------------|---------|
| group-1 | `31999001` | `31678430` | Chicago DC, FOB PB, SAC F340 pickup allowance |
| group-2 | `11999002` | `11972410` | Riverside CA, FOB PP, SAC D240 freight |
| group-3 | `42999045` | `42484C45` | Sygma Kentucky, FOB PP, SAC D240 freight |

ISA: buyer `109563165` (Sysco) → vendor `7085892400`

## Reference samples (production structure)

`reference/us-foods/` and `reference/sysco/` — your original files, preserved for
regression and template comparison. **Prefer synthetic lifecycles** for routine
testing to avoid re-ingesting real PO numbers.

| Partner | Group | Production PO | 850 | 855 | 810 |
|---------|-------|---------------|-----|-----|-----|
| US Foods | 1 | `7535299Q` | ✓ | ✓ | ✓ |
| US Foods | 2 | `7736663F` | ✓ | ✓ | — |
| US Foods | 3 | `7745269Q` | ✓ | ✓ | ✓ |
| Sysco | 1 | `31678430` | ✓ | ✓ | ✓ |
| Sysco | 2 | `11972410` | ✓ | ✓ | ✓ |
| Sysco | 3 | `42484C45` | ✓ | ✓ | ✓ |

## Generic lifecycles — `lifecycles/PO-*`

Asterisk-delimited teaching examples (850/855/856/810/997/875/880/860).

## Quick test

```text
Test Files\lifecycles\us-foods\group-1\01_850_purchase_order.edi  →  C:\EDI\Inbound
```

Search the app for `7599901Q`.
