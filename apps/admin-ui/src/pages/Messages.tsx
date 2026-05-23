import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson } from '../api';
import { type MessageSummary, statusClass } from '../types';

export function MessagesPage() {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    fetchJson<{ messages: MessageSummary[] }>(`/admin/messages${q}`)
      .then((d) => setMessages(d.messages))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  return (
    <>
      <div className="page-header">
        <h2>Messages</h2>
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
                  No messages yet — send a test to{' '}
                  <code>support+t_123_m_45@reply.arivusystems.com</code>
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
                <td>
                  <Link to={`/messages/${m._id}`} className="link-btn">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
