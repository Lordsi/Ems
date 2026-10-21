import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function usePublicInfo() {
  return useQuery({ queryKey: ['public-info'], queryFn: () => api.get<{ orgName: string; registrationOpen: boolean }>('/public/info'), staleTime: 300_000 });
}

export function AuthShell({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  const { data } = usePublicInfo();
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-[42%] max-w-xl flex-col justify-between overflow-hidden bg-brand-900 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-700/40 blur-3xl" aria-hidden />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
            <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
              <path d="M9 10h14M9 16h10M9 22h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-lg font-semibold">{data?.orgName ?? 'Employee Management System'}</span>
        </div>
        <div className="relative">
          <h2 className="text-3xl font-semibold leading-tight">One trusted record for every employee.</h2>
          <p className="mt-4 max-w-md text-brand-100">
            Secure onboarding, verified employment numbers, payroll with second-person approval, and retirement planning — with every sensitive action audited.
          </p>
        </div>
        <p className="relative text-xs text-brand-300">Access is restricted to authorised personnel. Activity is logged.</p>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10 sm:items-center sm:px-8">
        <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-sm'}>
          <div className="mb-8 lg:hidden">
            <span className="text-lg font-semibold text-brand-800">{data?.orgName ?? 'Employee Management System'}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  );
}
