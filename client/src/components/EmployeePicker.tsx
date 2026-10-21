import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { Input, cx } from './ui';

export interface EmployeeOption {
  id: string;
  legalName: string;
  employmentNumber: string | null;
  departmentCode: string;
}

/** Type-ahead picker over active employees the user is allowed to see. */
export function EmployeePicker({
  value,
  onChange,
  placeholder = 'Search by name or employment number…',
  excludeId,
  departmentId,
  invalid,
  id,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
  placeholder?: string;
  excludeId?: string;
  departmentId?: string;
  invalid?: boolean;
  id?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<EmployeeOption[]>([]);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await api.get<EmployeeOption[]>(`/employees/options${qs({ q, departmentId })}`);
        if (!cancelled) {
          setOptions(rows.filter((r) => r.id !== excludeId));
          setActive(0);
        }
      } catch {
        if (!cancelled) setOptions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, excludeId, departmentId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300">
        <span className="truncate">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="ml-2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Clear selection">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const choose = (o: EmployeeOption) => {
    onChange({ id: o.id, name: `${o.legalName}${o.employmentNumber ? ` (${o.employmentNumber})` : ''}` });
    setOpen(false);
    setQ('');
  };

  return (
    <div className="relative" ref={box}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        id={id}
        className="pl-9"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        invalid={invalid}
        placeholder={placeholder}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">No matching employees</li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={cx('flex cursor-pointer items-center justify-between gap-3 px-3 py-2', i === active && 'bg-brand-50')}
              >
                <span className="truncate">{o.legalName}</span>
                <span className="shrink-0 font-mono text-xs text-slate-500">{o.employmentNumber ?? o.departmentCode}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
