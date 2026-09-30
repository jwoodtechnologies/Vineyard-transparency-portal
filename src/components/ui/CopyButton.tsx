import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { Button, type ButtonProps } from './Button';
import { useToast } from './Toast';
import { copyText } from '@/lib/clipboard';

export function CopyLinkButton({ url, label = 'Copy link', ...rest }: { url: string; label?: string } & Omit<ButtonProps, 'onClick'>) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <Button
      {...rest}
      icon={done ? <Check className="size-4 text-ok" /> : <Link2 className="size-4" />}
      onClick={async () => {
        const ok = await copyText(url);
        toast(ok ? 'Link copied to clipboard' : 'Could not copy — select the address bar instead', ok ? 'ok' : 'warn');
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
    >
      {label}
    </Button>
  );
}
