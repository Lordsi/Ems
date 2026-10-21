import { useParams } from 'react-router';
import { Printer } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { date, dateTime, label, money } from '../../lib/format';
import { Alert, Button, ErrorState, PageHeader, PageLoader } from '../../components/ui';

interface Line {
  label: string;
  category: string;
  amount: number;
}

interface Payslip {
  id: string;
  payslipNumber: string;
  issuedAt: string;
  payrollRecordId: string;
  superseded: boolean;
  currentPaymentStatus: string;
  organization: { name: string; address: string | null; phone: string | null; email: string | null };
  employee: { name: string; employmentNumber: string | null; department: string; jobTitle: string | null };
  period: { code: string; name: string; startDate: string; endDate: string };
  paymentDate: string | null;
  currency: string;
  revision: number;
  basicSalary: number;
  earnings: Line[];
  deductions: Line[];
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
}

function Rows({ title, rows, total, currency, negative }: { title: string; rows: { label: string; amount: number }[]; total: number; currency: string; negative?: boolean }) {
  return (
    <div>
      <h3 className="border-b border-slate-300 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-1.5 text-slate-400">None</td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right tabular-nums">{money(r.amount, currency)}</td>
              </tr>
            ))
          )}
          <tr className="border-t border-slate-300 font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">
              {negative ? '−' : ''}
              {money(total, currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PayslipPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const q = useApi<Payslip>(`/payslips/${id}`);
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const cur = s.currency;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print">
        <PageHeader
          back={can('payroll.read') ? { to: `/finance/records/${s.payrollRecordId}`, label: 'Payroll record' } : { to: '/my-payslips', label: 'My payslips' }}
          title={`Payslip · ${s.period.name}`}
          description="Use your browser's print dialog to print or save as PDF."
          actions={
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Print / Save PDF
            </Button>
          }
        />
        {s.superseded && (
          <Alert tone="warning" className="mb-4">
            This payslip belongs to a payroll record that has since been corrected by a later revision. Refer to the most recent payslip for this period.
          </Alert>
        )}
      </div>

      <article className="print-area rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-brand-700 pb-4">
          <div>
            <h2 className="text-xl font-bold text-brand-800">{s.organization.name}</h2>
            {s.organization.address && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{s.organization.address}</p>}
            <p className="text-sm text-slate-600">{[s.organization.phone, s.organization.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold uppercase tracking-wide text-slate-700">Payslip</p>
            <p className="font-mono text-xs text-slate-500">{s.payslipNumber}</p>
            <p className="text-xs text-slate-500">Issued {dateTime(s.issuedAt)}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-8 gap-y-2 py-5 text-sm">
          <div>
            <p className="text-xs text-slate-500">Employee</p>
            <p className="font-medium">{s.employee.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Employment number</p>
            <p className="font-mono font-medium">{s.employee.employmentNumber ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Department</p>
            <p className="font-medium">{s.employee.department}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Job title</p>
            <p className="font-medium">{s.employee.jobTitle ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Pay period</p>
            <p className="font-medium">
              {s.period.name} ({date(s.period.startDate)} – {date(s.period.endDate)})
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Payment date · status</p>
            <p className="font-medium">
              {date(s.paymentDate)} · {label(s.currentPaymentStatus)}
            </p>
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          <Rows title="Earnings" rows={[{ label: 'Basic salary', amount: s.basicSalary }, ...s.earnings]} total={s.grossEarnings} currency={cur} />
          <Rows title="Deductions" rows={s.deductions} total={s.totalDeductions} currency={cur} negative />
        </section>

        <section className="mt-6 flex items-center justify-between rounded-lg bg-brand-50 px-5 py-4 print:border print:border-slate-300 print:bg-white">
          <span className="text-sm font-semibold uppercase tracking-wide text-brand-800">Net pay</span>
          <span className="text-2xl font-bold tabular-nums text-brand-900">{money(s.netPay, cur)}</span>
        </section>

        <footer className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-500">
          {s.revision > 1 && <p>Revision {s.revision} — supersedes earlier payslips for this period.</p>}
          <p>This payslip was generated from an approved payroll record and is a confidential document.</p>
        </footer>
      </article>
    </div>
  );
}
