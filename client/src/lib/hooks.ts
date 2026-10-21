import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData, type QueryKey } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from './api';
import { useToast } from '../components/toast';

/** GET helper keyed by the request path. */
export function useApi<T>(path: string | null, opts: { keepPrevious?: boolean; refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: [path],
    queryFn: () => api.get<T>(path!),
    enabled: !!path,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
    refetchInterval: opts.refetchInterval,
  });
}

/**
 * Mutation helper: shows a toast on success/error, exposes field-level validation errors,
 * and invalidates cached queries whose path starts with any of the given prefixes.
 */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); invalidate?: string[]; onSuccess?: (r: TResult, vars: TVars) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setFieldErrors({}),
    onSuccess: async (r, vars) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      const prefixes = opts.invalidate ?? [];
      await qc.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey as QueryKey;
          const first = typeof key[0] === 'string' ? key[0] : '';
          return first === 'me' || prefixes.some((p) => first.startsWith(p));
        },
      });
      opts.onSuccess?.(r, vars);
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) setFieldErrors(e.fields);
      if (e instanceof ApiError && e.code === 'REAUTH_CANCELLED') return;
      if (!opts.silentError) toast.error(errorMessage(e));
    },
  });
  return { ...m, fieldErrors, setFieldErrors };
}

/** Small form-state helper. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set =
    <K extends keyof T>(key: K) =>
    (value: T[K]) =>
      setValues((v) => ({ ...v, [key]: value }));
  const bind = <K extends keyof T>(key: K) => ({
    value: (values[key] ?? '') as string,
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  return { values, setValues, set, bind, reset: () => setValues(initial) };
}

/** Converts empty strings to null so optional fields clear correctly on the server. */
export function nullify<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: T[K] | null } {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === '' ? null : v])) as { [K in keyof T]: T[K] | null };
}
