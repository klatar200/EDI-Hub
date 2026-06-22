/**
 * UI Phase Sprint 4.1 — Form primitives.
 *
 * Thin, typed wrappers over native input / select / textarea so callers
 * get token-aware styling, focus rings, error + hint states, and one
 * import path for every form control.
 *
 *   <FormField label="PO number" hint="Sysco's invoice format is PO-NNNNN" error={errors.po}>
 *     <Input value={po} onChange={(e) => setPo(e.target.value)} />
 *   </FormField>
 *
 * The control components are still the native DOM elements at runtime,
 * so existing libraries (react-hook-form, etc.) and tests that target
 * the underlying input work unchanged.
 */
import {
  forwardRef,
  useId,
  type ForwardedRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

// ─────────────────────────────────────────────────────────────
// Shared styling
// ─────────────────────────────────────────────────────────────
//
// `controlBase` is the token-aware look every form control inherits:
// matching radius, border, padding, focus ring, dark-mode-safe colors.
// Components extend it with their layout-specific bits (height, padding
// shape, monospace, etc.).

const controlBase =
  'block w-full rounded-md border border-[var(--color-surface-border)] bg-[var(--color-surface-card)] text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] shadow-xs transition focus:border-[var(--color-brand-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/30 disabled:cursor-not-allowed disabled:opacity-50';

const errorBase =
  'border-[var(--color-error-500)] focus:border-[var(--color-error-500)] focus:ring-[var(--color-error-500)]/30';

// ─────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Render with monospace styling — useful for IDs, control numbers. */
  mono?: boolean;
  /** Error state — paints the border red + matching focus ring. */
  invalid?: boolean;
  /** Render small variant (filter bars). */
  size?: 'sm' | 'md';
}

export const Input = forwardRef(function Input(
  { mono = false, invalid = false, size = 'md', className = '', ...rest }: InputProps,
  ref: ForwardedRef<HTMLInputElement>,
): JSX.Element {
  const sizing = size === 'sm' ? 'px-2 py-1' : 'px-3 py-1.5';
  return (
    <input
      ref={ref}
      className={`${controlBase} ${sizing} ${mono ? 'font-mono' : ''} ${invalid ? errorBase : ''} ${className}`}
      {...rest}
    />
  );
});

// ─────────────────────────────────────────────────────────────
// Select
// ─────────────────────────────────────────────────────────────

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  size?: 'sm' | 'md';
  /** Allows shorthand `options` instead of children — most filter selects
   *  pass a flat list of value/label pairs. */
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = forwardRef(function Select(
  { invalid = false, size = 'md', options, className = '', children, ...rest }: SelectProps,
  ref: ForwardedRef<HTMLSelectElement>,
): JSX.Element {
  const sizing = size === 'sm' ? 'px-2 py-1 pr-7' : 'px-3 py-1.5 pr-8';
  // Custom chevron via background SVG — native arrows differ wildly across
  // browsers + dark mode. Token-colored stroke so it switches with the theme.
  const chevron =
    "appearance-none bg-[length:14px_14px] bg-no-repeat bg-[right_0.5rem_center] bg-[image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M6 9l6 6 6-6%22/></svg>')] text-[var(--color-fg-muted)]";
  return (
    <select
      ref={ref}
      className={`${controlBase} ${sizing} ${chevron} ${invalid ? errorBase : ''} ${className}`}
      {...rest}
    >
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
});

// ─────────────────────────────────────────────────────────────
// Textarea
// ─────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef(function Textarea(
  { invalid = false, className = '', rows = 3, ...rest }: TextareaProps,
  ref: ForwardedRef<HTMLTextAreaElement>,
): JSX.Element {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`${controlBase} px-3 py-2 ${invalid ? errorBase : ''} ${className}`}
      {...rest}
    />
  );
});

// ─────────────────────────────────────────────────────────────
// Switch (token-styled checkbox role=switch)
// ─────────────────────────────────────────────────────────────

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  /** Aria label — required when no visible `label` is rendered. */
  ariaLabel?: string;
  id?: string;
}

export function Switch({ checked, onChange, disabled, label, ariaLabel, id }: SwitchProps): JSX.Element {
  const auto = useId();
  const inputId = id ?? `switch-${auto}`;
  const switchEl = (
    <button
      type="button"
      role="switch"
      id={inputId}
      aria-checked={checked}
      aria-label={!label ? ariaLabel : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition ${
        checked ? 'bg-[var(--color-brand-500)]' : 'bg-[var(--color-surface-border)]'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        aria-hidden
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
  if (!label) return switchEl;
  return (
    <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2">
      {switchEl}
      <span className="text-sm text-[var(--color-fg)]">{label}</span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// Label
// ─────────────────────────────────────────────────────────────

interface LabelProps {
  htmlFor?: string;
  children: ReactNode;
  /** Mark the field as required — appends a subtle "*" indicator. */
  required?: boolean;
  className?: string;
}

export function Label({ htmlFor, children, required, className = '' }: LabelProps): JSX.Element {
  return (
    <label
      htmlFor={htmlFor}
      className={`text-xs font-medium text-[var(--color-fg-muted)] ${className}`}
    >
      {children}
      {required ? <span className="ml-0.5 text-[var(--color-error-500)]">*</span> : null}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// FormField — composes Label + control + hint/error in one unit.
// ─────────────────────────────────────────────────────────────

interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  /** Error message — renders in error red below the control, and pages
   *  using <Input invalid> / <Select invalid> / <Textarea invalid> can
   *  toggle the border in tandem. */
  error?: ReactNode;
  required?: boolean;
  /** Stacked (default) or inline (label and control on one row, label fixed-width).
   *  Useful for compact filter strips. */
  layout?: 'stack' | 'inline';
  /** Optional id to wire the label to the control's id; auto-generated otherwise. */
  htmlFor?: string;
  children: ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  required,
  layout = 'stack',
  htmlFor,
  children,
}: FormFieldProps): JSX.Element {
  const auto = useId();
  const id = htmlFor ?? `ff-${auto}`;
  if (layout === 'inline') {
    return (
      <div className="flex items-center gap-3">
        {label ? (
          <Label htmlFor={id} required={required} className="w-32 shrink-0">
            {label}
          </Label>
        ) : null}
        <div className="flex-1 space-y-1">
          {children}
          {error ? <p className="text-xs text-[var(--color-error-700)]">{error}</p> : hint ? <p className="text-xs text-[var(--color-fg-subtle)]">{hint}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-[var(--color-error-700)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--color-fg-subtle)]">{hint}</p>
      ) : null}
    </div>
  );
}
