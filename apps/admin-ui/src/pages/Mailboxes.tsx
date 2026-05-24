import { useCallback, useEffect, useState } from 'react';
import { confirmDelete, deleteJson, fetchJson } from '../api';

interface Tenant {
  _id: string;
  name: string;
}

interface Mailbox {
  _id: string;
  tenantId: string;
  type: string;
  name: string;
  routingAddress: string;
}

export function MailboxesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingTenantId, setDeletingTenantId] = useState<string | null>(null);
  const [deletingMailboxId, setDeletingMailboxId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchJson<{ tenants: Tenant[]; mailboxes: Mailbox[] }>('/admin/mailboxes')
      .then((d) => {
        setTenants(d.tenants);
        setMailboxes(d.mailboxes);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteTenant(tenantId: string) {
    if (
      !confirmDelete(
        `Delete tenant "${tenantId}"? Only empty tenants (no mailboxes or messages) can be removed.`,
      )
    ) {
      return;
    }
    setDeletingTenantId(tenantId);
    try {
      await deleteJson(`/admin/tenants/${tenantId}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingTenantId(null);
    }
  }

  async function deleteMailbox(mailbox: Mailbox) {
    if (
      !confirmDelete(
        `Delete mailbox "${mailbox.name}" (${mailbox.routingAddress})? Delete its messages first if any exist.`,
      )
    ) {
      return;
    }
    setDeletingMailboxId(mailbox._id);
    try {
      await deleteJson(`/admin/mailboxes/${mailbox._id}?tenantId=${encodeURIComponent(mailbox.tenantId)}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingMailboxId(null);
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h2>Mailboxes</h2>
      {loading && <p className="muted">Loading…</p>}

      <div className="card">
        <h3 className="section-title">Tenants</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && tenants.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No tenants — run seed script or provision via CRM API
                </td>
              </tr>
            )}
            {tenants.map((t) => (
              <tr key={t._id}>
                <td className="mono">{t._id}</td>
                <td>{t.name}</td>
                <td className="actions-cell">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={deletingTenantId === t._id}
                    onClick={() => deleteTenant(t._id)}
                  >
                    {deletingTenantId === t._id ? '…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="section-title">Mailboxes</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Tenant</th>
              <th>Routing address</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && mailboxes.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No mailboxes — run seed script or provision via CRM API
                </td>
              </tr>
            )}
            {mailboxes.map((m) => (
              <tr key={m._id}>
                <td>{m.name}</td>
                <td>{m.type}</td>
                <td className="mono small">{m.tenantId}</td>
                <td>
                  <code>{m.routingAddress}</code>
                </td>
                <td className="actions-cell">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={deletingMailboxId === m._id}
                    onClick={() => deleteMailbox(m)}
                  >
                    {deletingMailboxId === m._id ? '…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
