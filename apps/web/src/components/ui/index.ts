/**
 * UI Phase — primitives barrel.
 *
 * Single import path for hand-rolled UI primitives:
 *
 *   import {
 *     PageHeader, EmptyState, ErrorState,
 *     StatusPill, rawFileTone,
 *     Card, ThemeToggle,
 *     DataTable, Pagination,
 *     FilterChip, FilterChipRow,
 *     Skeleton, Shimmer,
 *   } from '../components/ui';
 */
export { PageHeader } from './PageHeader.tsx';
export { EmptyState } from './EmptyState.tsx';
export { ErrorState } from './ErrorState.tsx';
export { StatusPill, rawFileTone } from './StatusPill.tsx';
export type { StatusTone, StatusSize } from './StatusPill.tsx';
export { Card } from './Card.tsx';
export { ThemeToggle } from './ThemeToggle.tsx';
export { DataTable } from './DataTable.tsx';
export type { SortDirection } from './DataTable.tsx';
export { Pagination } from './Pagination.tsx';
export { FilterChip, FilterChipRow } from './FilterChip.tsx';
export { Skeleton, Shimmer } from './Skeleton.tsx';
export { Input, Select, Textarea, Switch, Label, FormField } from './forms.tsx';
export { Modal } from './Modal.tsx';
export { Sparkline } from './Sparkline.tsx';
