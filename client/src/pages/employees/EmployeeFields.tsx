import type { ReactNode } from 'react';
import { label } from '../../lib/format';
import { EMPLOYMENT_TYPES, FIELD_LABELS, type EmployeeDetail, type Lookups } from '../../lib/types';
import { EmployeePicker } from '../../components/EmployeePicker';
import { Field, Input, Select, Textarea } from '../../components/ui';

export const CHANGEABLE_STATUSES = ['active', 'on_leave', 'suspended', 'terminated'] as const;

export type FieldValues = Record<string, string>;

/** Current raw values of every editable field, as strings for form inputs. */
export function currentValues(emp: EmployeeDetail): FieldValues {
  return {
    legalName: emp.legalName,
    preferredName: emp.preferredName ?? '',
    dateOfBirth: emp.personal?.dateOfBirth ?? '',
    phone: emp.personal?.phone ?? '',
    personalEmail: emp.personal?.personalEmail ?? '',
    address: emp.personal?.address ?? '',
    departmentId: emp.department.id,
    locationId: emp.location?.id ?? '',
    workLocation: emp.workLocation ?? '',
    jobTitleId: emp.jobTitle?.id ?? '',
    gradeId: emp.gradeId ?? '',
    supervisorId: emp.supervisor?.id ?? '',
    employmentDate: emp.employment?.employmentDate ?? '',
    employmentType: emp.employment?.employmentType ?? 'permanent',
    contractEndDate: emp.employment?.contractEndDate ?? '',
    employmentStatus: emp.employmentStatus,
  };
}

export function changedFields(before: FieldValues, after: FieldValues, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => (before[k] ?? '') !== (after[k] ?? '')).map((k) => [k, after[k] === '' ? null : after[k]]));
}

/** Renders the right input for an employee field key. */
export function EmployeeFieldInput({
  name,
  values,
  setValue,
  lookups,
  error,
  supervisorLabel,
  setSupervisorLabel,
  employeeId,
  hint,
}: {
  name: string;
  values: FieldValues;
  setValue: (k: string, v: string) => void;
  lookups: Lookups | undefined;
  error?: string;
  supervisorLabel: string;
  setSupervisorLabel: (s: string) => void;
  employeeId?: string;
  hint?: string;
}) {
  const v = values[name] ?? '';
  const on = (e: { target: { value: string } }) => setValue(name, e.target.value);
  const title = FIELD_LABELS[name] ?? name;
  const dept = lookups?.departments.find((d) => d.id === values.departmentId);
  let control: (id: string) => ReactNode;
  switch (name) {
    case 'dateOfBirth':
    case 'employmentDate':
    case 'contractEndDate':
      control = (id) => <Input id={id} type="date" value={v} onChange={on} invalid={!!error} />;
      break;
    case 'address':
      control = (id) => <Textarea id={id} rows={2} value={v} onChange={on} invalid={!!error} />;
      break;
    case 'departmentId':
      control = (id) => (
        <Select id={id} value={v} onChange={on} invalid={!!error}>
          {lookups?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.code})
            </option>
          ))}
        </Select>
      );
      break;
    case 'locationId':
      control = (id) => (
        <Select id={id} value={v} onChange={on} invalid={!!error}>
          <option value="">Unassigned</option>
          {lookups?.locations
            .filter((l) => !dept || !dept.locationIds.length || dept.locationIds.includes(l.id) || l.id === v)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </Select>
      );
      break;
    case 'jobTitleId':
      control = (id) => (
        <Select id={id} value={v} onChange={on} invalid={!!error}>
          <option value="">Unassigned</option>
          {lookups?.jobTitles
            .filter((t) => !t.departmentId || t.departmentId === values.departmentId || t.id === v)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </Select>
      );
      break;
    case 'gradeId':
      control = (id) => (
        <Select id={id} value={v} onChange={on} invalid={!!error}>
          <option value="">Unassigned</option>
          {lookups?.grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      );
      break;
    case 'employmentType':
      control = (id) => (
        <Select id={id} value={v} onChange={on} invalid={!!error}>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </Select>
      );
      break;
    case 'employmentStatus':
      control = (id) => (
        <Select id={id} value={v} onChange={on} invalid={!!error}>
          {!CHANGEABLE_STATUSES.includes(v as (typeof CHANGEABLE_STATUSES)[number]) && <option value={v}>{label(v)}</option>}
          {CHANGEABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Select>
      );
      break;
    case 'supervisorId':
      control = (id) => (
        <EmployeePicker
          id={id}
          excludeId={employeeId}
          invalid={!!error}
          value={v ? { id: v, name: supervisorLabel || 'Selected supervisor' } : null}
          onChange={(o) => {
            setValue(name, o?.id ?? '');
            setSupervisorLabel(o?.name ?? '');
          }}
        />
      );
      break;
    default:
      control = (id) => <Input id={id} type={name === 'personalEmail' ? 'email' : name === 'phone' ? 'tel' : 'text'} value={v} onChange={on} invalid={!!error} />;
  }
  return (
    <Field label={title} error={error} hint={hint}>
      {control}
    </Field>
  );
}
