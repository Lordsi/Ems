import { useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  FileText,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useMe } from '../lib/auth';
import { useApi } from '../lib/hooks';
import type { Permission } from '../../../shared/permissions';
import { ROLE_META } from '../../../shared/permissions';
import { Avatar, cx } from './ui';

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; perms?: Permission[]; needsEmployee?: boolean; end?: boolean };
type NavGroup = { title?: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/profile', label: 'My profile', icon: UserCircle, needsEmployee: true },
      { to: '/my-payslips', label: 'My payslips', icon: FileText, needsEmployee: true },
      { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Workforce',
    items: [
      { to: '/employees', label: 'Employee directory', icon: Users, perms: ['employee.read.all', 'employee.read.scoped'] },
      { to: '/organisation', label: 'Organisation', icon: Building2, perms: ['org.manage', 'employee.read.all', 'report.org', 'report.finance'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/finance', label: 'Payroll', icon: Banknote, perms: ['payroll.read', 'report.finance'] },
      { to: '/retirement', label: 'Retirement', icon: Hourglass, perms: ['retirement.read'] },
    ],
  },
  {
    title: 'Communication',
    items: [
      { to: '/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/events', label: 'Events', icon: CalendarDays },
    ],
  },
  {
    title: 'Governance',
    items: [
      { to: '/reports', label: 'Reports', icon: FileBarChart, perms: ['report.org', 'report.finance', 'retirement.read', 'audit.read', 'approval.read'] },
      { to: '/users', label: 'Users & access', icon: ShieldCheck, perms: ['role.assign', 'user.manage', 'scope.manage'] },
      { to: '/audit', label: 'Audit log', icon: ScrollText, perms: ['audit.read'] },
      { to: '/settings', label: 'Settings', icon: Settings, perms: ['settings.manage'] },
    ],
  },
];

function useNav() {
  const { can, me } = useAuth();
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.perms || can(...i.perms)) && (!i.needsEmployee || !!me?.user.employeeId)),
  })).filter((g) => g.items.length);
}

function Brand({ orgName }: { orgName: string }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
          <path d="M9 10h14M9 16h10M9 22h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">{orgName}</span>
        <span className="block text-[11px] uppercase tracking-wider text-brand-200">Employee Management</span>
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const groups = useNav();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Main">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  end={i.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-brand-100 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  <i.icon className="size-[18px] shrink-0 opacity-80" />
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserFooter() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      qc.clear();
      navigate('/login');
    }
  };
  const roleNames = me.user.roles
    .slice()
    .sort((a, b) => ROLE_META[b].rank - ROLE_META[a].rank)
    .map((r) => ROLE_META[r].name);
  return (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-3 rounded-md px-2 py-2">
        <Avatar name={me.user.displayName} size="sm" />
        <Link to="/account" className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{me.user.displayName}</p>
          <p className="truncate text-xs text-brand-200">{roleNames[0]}</p>
        </Link>
        <button type="button" onClick={logout} className="rounded p-1.5 text-brand-200 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { data } = useApi<{ unread: number }>('/notifications?pageSize=1', { refetchInterval: 60_000 });
  const unread = data?.unread ?? 0;
  return (
    <Link to="/notifications" className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}

export function Layout() {
  const me = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-900 lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-3">
          <Brand orgName={me.org.name} />
        </div>
        <SidebarNav />
        <UserFooter />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-900 shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-3">
              <Brand orgName={me.org.name} />
              <button type="button" onClick={() => setMobileOpen(false)} className="rounded p-1.5 text-brand-200 hover:bg-white/10" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
            <UserFooter />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="-ml-1 rounded p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            {me.employee?.employmentNumber && (
              <p className="hidden truncate text-sm text-slate-500 sm:block">
                {me.employee.departmentName} · <span className="font-mono">{me.employee.employmentNumber}</span>
              </p>
            )}
          </div>
          <NotificationBell />
          <Link to="/account" className="flex items-center gap-2 rounded-full p-1 hover:bg-slate-100" aria-label="Account">
            <Avatar name={me.user.displayName} size="sm" />
          </Link>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
