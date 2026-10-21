import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { ReauthDialog } from './components/ReauthDialog';
import { PageLoader } from './components/ui';
import { LoginPage } from './pages/auth/Login';
import { RegisterPage } from './pages/auth/Register';
import { AcceptInvitePage } from './pages/auth/AcceptInvite';
import { AccountBlocked, ForceMfaSetup, ForcePasswordChange, PendingVerification } from './pages/auth/Gates';
import { DashboardPage } from './pages/Dashboard';
import { DirectoryPage } from './pages/employees/Directory';
import { NewEmployeePage } from './pages/employees/NewEmployee';
import { EmployeeProfilePage, MyProfileRedirect } from './pages/employees/Profile';
import { ApprovalsPage } from './pages/Approvals';
import { AnnouncementDetailPage, AnnouncementsPage } from './pages/comms/Announcements';
import { EventDetailPage, EventsPage } from './pages/comms/Events';
import { NotificationsPage } from './pages/Notifications';
import { FinancePage } from './pages/finance/Finance';
import { PayrollPeriodPage } from './pages/finance/Period';
import { PayrollRecordPage } from './pages/finance/Record';
import { PayslipPage } from './pages/finance/Payslip';
import { MyPayslipsPage } from './pages/finance/MyPayslips';
import { RetirementPage } from './pages/retirement/Retirement';
import { RetirementReviewPage } from './pages/retirement/Review';
import { RetirementPoliciesPage } from './pages/retirement/Policies';
import { OrganisationPage } from './pages/Organisation';
import { UsersPage } from './pages/users/Users';
import { UserDetailPage } from './pages/users/UserDetail';
import { AuditPage } from './pages/Audit';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { AccountPage } from './pages/Account';
import { NotFoundPage } from './pages/NotFound';

function Root() {
  return (
    <>
      <Outlet />
      <ReauthDialog />
    </>
  );
}

/** Routes the signed-in user to the right place based on account state. The server enforces the same rules. */
function Protected() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!me || me.user.status === 'mfa_pending') {
    const next = location.pathname + location.search;
    return <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  if (me.user.status === 'pending_verification') return <PendingVerification />;
  if (me.user.status !== 'active') return <AccountBlocked />;
  if (me.user.mustChangePassword) return <ForcePasswordChange />;
  if (me.user.mfaSetupRequired) return <ForceMfaSetup />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/invite/:token', element: <AcceptInvitePage /> },
      {
        element: <Protected />,
        children: [
          {
            element: <Layout />,
            children: [
              { path: '/', element: <DashboardPage /> },
              { path: '/profile', element: <MyProfileRedirect /> },
              { path: '/employees', element: <DirectoryPage /> },
              { path: '/employees/new', element: <NewEmployeePage /> },
              { path: '/employees/:id', element: <EmployeeProfilePage /> },
              { path: '/approvals', element: <ApprovalsPage /> },
              { path: '/announcements', element: <AnnouncementsPage /> },
              { path: '/announcements/:id', element: <AnnouncementDetailPage /> },
              { path: '/events', element: <EventsPage /> },
              { path: '/events/:id', element: <EventDetailPage /> },
              { path: '/notifications', element: <NotificationsPage /> },
              { path: '/finance', element: <FinancePage /> },
              { path: '/finance/periods/:id', element: <PayrollPeriodPage /> },
              { path: '/finance/records/:id', element: <PayrollRecordPage /> },
              { path: '/payslips/:id', element: <PayslipPage /> },
              { path: '/my-payslips', element: <MyPayslipsPage /> },
              { path: '/retirement', element: <RetirementPage /> },
              { path: '/retirement/policies', element: <RetirementPoliciesPage /> },
              { path: '/retirement/:id', element: <RetirementReviewPage /> },
              { path: '/organisation', element: <OrganisationPage /> },
              { path: '/users', element: <UsersPage /> },
              { path: '/users/:id', element: <UserDetailPage /> },
              { path: '/audit', element: <AuditPage /> },
              { path: '/reports', element: <ReportsPage /> },
              { path: '/settings', element: <SettingsPage /> },
              { path: '/account', element: <AccountPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
