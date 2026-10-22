import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X, XCircle } from 'lucide-react';
import { initials, label, toneFor, type Tone } from '../lib/format';
import { errorMessage } from '../lib/api';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/* Buttons                                                            */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm disabled:bg-brand-300',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:bg-emerald-300',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ to, variant = 'secondary', size = 'md', icon, children, className }: { to: string; variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                      */
/* ------------------------------------------------------------------ */

const CONTROL =
  'block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx(CONTROL, invalid && 'ring-red-400 focus:ring-red-500', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(CONTROL, 'pr-8', invalid && 'ring-red-400 focus:ring-red-500', className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(CONTROL, invalid && 'ring-red-400 focus:ring-red-500', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export function Field({
  label: text,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {text}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, label: text, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-slate-800">{text}</span>
        {description && <span className="block text-slate-500">{description}</span>}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                  */
/* ------------------------------------------------------------------ */

export function PoweredBy() {
  return <p className="py-4 text-center text-xs text-slate-400">Powered by aether studio</p>;
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx('rounded-lg bg-white shadow-sm ring-1 ring-slate-200', padded && 'p-5', className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link to={back.to} className="no-print mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const BADGE_TONES: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', BADGE_TONES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={toneFor(status)}>{label(status)}</Badge>;
}

export function StatCard({ label: text, value, hint, icon, tone = 'brand', to }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'amber' | 'green' | 'red' | 'violet'; to?: string }) {
  const tones = { brand: 'bg-brand-50 text-brand-700', amber: 'bg-amber-50 text-amber-700', green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700', violet: 'bg-violet-50 text-violet-700' };
  const body = (
    <div className="flex items-start gap-4">
      {icon && <div className={cx('rounded-lg p-2.5', tones[tone])}>{icon}</div>}
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{text}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-300">
      {body}
    </Link>
  ) : (
    <Card>{body}</Card>
  );
}

export function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-14 text-lg' };
  return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800', sizes[size])}>{initials(name)}</span>;
}

export function DescriptionList({ items, columns = 2 }: { items: { label: string; value: ReactNode; hidden?: boolean }[]; columns?: 1 | 2 | 3 }) {
  const cols = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' };
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-4', cols[columns])}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{i.label}</dt>
            <dd className="mt-1 break-words text-sm text-slate-900">{i.value ?? '—'}</dd>
          </div>
        ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                             */
/* ------------------------------------------------------------------ */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: keyof typeof ALIGN }) {
  return <th scope="col" className={cx('whitespace-nowrap bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500', ALIGN[align], className)}>{children}</th>;
}

export function Td({ children, className, align = 'left', colSpan }: { children?: ReactNode; className?: string; align?: keyof typeof ALIGN; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx('px-4 py-3 align-middle text-slate-700', ALIGN[align], className)}>{children}</td>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>
        Showing <span className="font-medium">{from}</span>–<span className="font-medium">{to}</span> of <span className="font-medium">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="size-4" />} />
        <span className="px-2">
          Page {page} of {pages}
        </span>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="size-4" />} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                           */
/* ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-brand-600', className)} aria-label="Loading" />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'success' | 'warning' | 'error'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const styles = {
    info: ['bg-sky-50 text-sky-800 ring-sky-200', Info],
    success: ['bg-emerald-50 text-emerald-800 ring-emerald-200', CheckCircle2],
    warning: ['bg-amber-50 text-amber-900 ring-amber-200', AlertTriangle],
    error: ['bg-red-50 text-red-800 ring-red-200', XCircle],
  } as const;
  const [cls, Icon] = styles[tone];
  return (
    <div className={cx('flex gap-3 rounded-md p-3.5 text-sm ring-1 ring-inset', cls, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx(!!title && 'mt-1', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert tone="error" title="Unable to load this page">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="mt-2 font-medium underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </Alert>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                              */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const focusable = () => Array.from(node?.querySelectorAll<HTMLElement>('input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    (focusable().find((el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) ?? focusable()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = focusable();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl', widths[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                               */
/* ------------------------------------------------------------------ */

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; hidden?: boolean }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="no-print mb-5 border-b border-slate-200">
      <nav className="-mb-px flex gap-5 overflow-x-auto" role="tablist">
        {tabs
          .filter((t) => !t.hidden)
          .map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={value === t.key}
              onClick={() => onChange(t.key)}
              className={cx(
                'whitespace-nowrap border-b-2 px-0.5 pb-3 pt-1 text-sm font-medium transition-colors',
                value === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
              )}
            >
              {t.label}
            </button>
          ))}
      </nav>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">{children}</div>;
}
