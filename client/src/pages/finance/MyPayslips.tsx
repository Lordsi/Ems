import { useApi } from '../../lib/hooks';
import { Card, ErrorState, PageHeader, PageLoader } from '../../components/ui';
import { PayrollTable, type PayrollRow } from '../employees/ProfileTabs';

export function MyPayslipsPage() {
  const q = useApi<PayrollRow[]>('/me/payroll');
  return (
    <div>
      <PageHeader title="My payslips" description="Approved payroll for your employment record. Open a payslip to print or save it as a PDF." />
      {q.isLoading ? (
        <PageLoader />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card padded={false}>
          <PayrollTable rows={q.data} financeView={false} />
        </Card>
      )}
    </div>
  );
}
