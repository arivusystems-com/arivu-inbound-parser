import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

interface Mailbox {
  _id: string;
  tenantId: string;
  type: string;
  name: string;
  routingAddress: string;
}

export function MailboxesPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ mailboxes: Mailbox[] }>('/admin/mailboxes')
      .then((d) => setMailboxes(d.mailboxes))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h2>Mailboxes</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Tenant</th>
              <th>Routing address</th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No mailboxes — run seed script
                </td>
              </tr>
            )}
            {mailboxes.map((m) => (
              <tr key={m._id}>
                <td>{m.name}</td>
                <td>{m.type}</td>
                <td>{m.tenantId}</td>
                <td>
                  <code>{m.routingAddress}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
