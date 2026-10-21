import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Alert, Button, Input, Modal } from '../../components/ui';

/** The invitation token is shown exactly once; email delivery is not configured. */
export function InviteLinkModal({ open, url, days, onClose }: { open: boolean; url: string; days: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal open={open} onClose={onClose} title="Invitation link created" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <Alert tone="warning" title="Copy this link now">
          For security, the link is shown only once. Share it with the employee through a trusted channel. It expires in {days} days and can be used only once.
        </Alert>
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Invitation link" className="font-mono text-xs" />
          <Button variant="secondary" onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
