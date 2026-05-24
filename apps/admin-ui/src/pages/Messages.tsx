import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { confirmDelete, deleteJson, fetchJson } from '../api';
import { type MessageSummary, statusClass } from '../types';

export function MessagesPage() {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [mailboxFilter, setMailboxFilter] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (tenantFilter) params.set('tenantId', tenantFilter);
    if (mailboxFilter) params.set('mailboxId', mailboxFilter);
    const q = params.toString() ? `?${params.toString()}` : '';
    fetchJson<{ messages: MessageSummary[] }>(`/admin/messages${q}`)
      .then((d) => setMessages(d.messages))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [statusFilter, tenantFilter, mailboxFilter]);

  async function deleteOne(id: string) {
    if (!confirmDelete('Delete this message and its OCI files?')) return;
    setDeletingId(id);
    try {
      await deleteJson(`/admin/messages/${id}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  async function bulkDelete() {
    if (!tenantFilter && !mailboxFilter) {
      alert('Enter tenant ID and/or mailbox ID in the filters above first.');
      return;
    }
    if (!confirmDelete('Delete ALL messages matching the current tenant/mailbox filters?')) return;
    setBulkDeleting(true);
    try {
      const params = new URLSearchParams();
      if (tenantFilter) params.set('tenantId', tenantFilter);
      if (mailboxFilter) params.set('mailboxId', mailboxFilter);
      const result = await deleteJson<{ deleted: number }>(`/admin/messages?${params.toString()}`);
      alert(`Deleted ${result.deleted} message(s).`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Messages</h2>
        <div className="page-header-actions">
          <input
            className="select"
            placeholder="tenantId filter"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value.trim())}
            aria-label="Tenant filter"
          />
          <input
            className="select"
            placeholder="mailboxId filter"
            value={mailboxFilter}
            onChange={(e) => setMailboxFilter(e.target.value.trim())}
            aria-label="Mailbox filter"
          />
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="attachments_pending">attachments_pending</option>
            <option value="processed">processed</option>
            <option value="queued">queued</option>
            <option value="parsing">parsing</option>
            <option value="failed">failed</option>
          </select>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={bulkDeleting}
            onClick={bulkDelete}
          >
            {bulkDeleting ? '…' : 'Delete filtered'}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>From</th>
              <th>Status</th>
              <th>Received</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && messages.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No messages yet.
                </td>
              </tr>
            )}
            {messages.map((m) => (
              <tr key={m._id}>
                <td>
                  <Link to={`/messages/${m._id}`}>{m.subject || '(no subject)'}</Link>
                  <div className="muted mono small">{m._id}</div>
                </td>
                <td>{m.from?.address || '—'}</td>
                <td>
                  <span className={statusClass(m.processingStatus)}>{m.processingStatus}</span>
                </td>
                <td>{new Date(m.receivedAt).toLocaleString()}</td>
                <td className="actions-cell">
                  <Link to={`/messages/${m._id}`} className="link-btn">
                    View
                  </Link>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={deletingId === m._id}
                    onClick={() => deleteOne(m._id)}
                  >
                    {deletingId === m._id ? '…' : 'Delete'}
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
