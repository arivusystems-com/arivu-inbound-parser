import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

export function LogsPage() {
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    fetchJson<{ note: string; logs: unknown[] }>('/admin/logs')
      .then((d) => setNote(d.note))
      .catch(() => setNote('Could not reach log API'));
  }, []);

  return (
    <>
      <h2>Logs</h2>
      <div className="card">
        <p className="muted">{note}</p>
        <p>In development, tail service logs:</p>
        <pre>pnpm --filter @arivu/smtp-server dev</pre>
        <pre>pnpm --filter @arivu/parser-worker dev</pre>
      </div>
    </>
  );
}
