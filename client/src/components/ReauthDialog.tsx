import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, errorMessage, setReauthHandler } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Field, Input, Modal } from './ui';

/**
 * Global password (and MFA) confirmation prompt. Sensitive API calls that fail with
 * REAUTH_REQUIRED open this dialog and are retried once the user confirms.
 */
export function ReauthDialog() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setPassword('');
          setCode('');
          setError(null);
          setOpen(true);
        }),
    );
    return () => setReauthHandler(null);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reauth', { password, ...(me?.user.mfaEnabled ? { code } : {}) });
      finish(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-brand-700" /> Confirm it&apos;s you
        </span>
      }
      description="This is a sensitive action. Please confirm your password to continue."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Password" required>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        {me?.user.mfaEnabled && (
          <Field label="Authenticator code" required>
            {(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />}
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  );
}
