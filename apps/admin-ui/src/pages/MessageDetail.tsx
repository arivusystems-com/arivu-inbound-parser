import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { confirmDelete, deleteJson, fetchJson, postJson } from '../api';
import { type MessageDetail, statusClass } from '../types';

function formatAddresses(list: { address: string; name?: string }[]): string {
  if (!list?.length) return '—';
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [message, setMessage] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);
  const [redispatching, setRedispatching] = useState(false);
  const [redispatchMsg, setRedispatchMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetchJson<{ message: MessageDetail }>(`/admin/messages/${id}`)
      .then((d) => setMessage(d.message))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRedispatchEvent() {
    if (!id) return;
    setRedispatching(true);
    setRedispatchMsg(null);
    try {
      await postJson<{ ok: boolean }>(`/admin/messages/${id}/redispatch-event`);
      setRedispatchMsg('CRM event redispatch queued.');
      setTimeout(load, 2000);
    } catch (e) {
      setRedispatchMsg(e instanceof Error ? e.message : 'Redispatch failed');
    } finally {
      setRedispatching(false);
    }
  }

  async function handleReplay() {
    if (!id) return;
    setReplaying(true);
    setReplayMsg(null);
    try {
      await postJson<{ ok: boolean; status: string }>(`/admin/messages/${id}/replay`);
      setReplayMsg('Replay queued — status will update shortly.');
      setTimeout(load, 2000);
    } catch (e) {
      setReplayMsg(e instanceof Error ? e.message : 'Replay failed');
    } finally {
      setReplaying(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!confirmDelete('Delete this message and its OCI files? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deleteJson(`/admin/messages/${id}`);
      navigate('/messages');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
    }
  }

  if (loading) return <p className="muted">Loading message…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!message) return <p className="error">Message not found</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/messages" className="back-link">
            ← Messages
          </Link>
          <h2>{message.subject || '(no subject)'}</h2>
          <p className="muted mono">{message._id}</p>
        </div>
        <div className="page-header-actions">
          <span className={statusClass(message.processingStatus)}>{message.processingStatus}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={replaying || !message.rawMimePath}
            onClick={handleReplay}
          >
            {replaying ? 'Queuing…' : 'Replay parse'}
          </button>
          {message.processingStatus === 'processed' && (
            <button
              type="button"
              className="btn"
              disabled={redispatching}
              onClick={handleRedispatchEvent}
            >
              {redispatching ? 'Queuing…' : 'Redispatch CRM event'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {replayMsg && (
        <p className={replayMsg.toLowerCase().includes('fail') ? 'error' : 'success'}>{replayMsg}</p>
      )}
      {redispatchMsg && (
        <p className={redispatchMsg.toLowerCase().includes('fail') ? 'error' : 'success'}>
          {redispatchMsg}
        </p>
      )}

      {message.errorMessage && (
        <div className="card card-error">
          <strong>Parse error</strong>
          <pre className="pre-block">{message.errorMessage}</pre>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Routing</h3>
        <dl className="detail-grid">
          <dt>Tenant</dt>
          <dd>{message.tenantId}</dd>
          <dt>Mailbox</dt>
          <dd>{message.mailboxId}</dd>
          <dt>Raw MIME (OCI)</dt>
          <dd className="mono">{message.rawMimePath || '—'}</dd>
          <dt>External Message-ID</dt>
          <dd className="mono">{message.messageId || '—'}</dd>
          <dt>Thread</dt>
          <dd className="mono">{message.threadId || '—'}</dd>
          <dt>Received</dt>
          <dd>{new Date(message.receivedAt).toLocaleString()}</dd>
          <dt>CRM event</dt>
          <dd>
            {message.eventDispatchedAt
              ? `Dispatched ${new Date(message.eventDispatchedAt).toLocaleString()}`
              : message.processingStatus === 'processed'
                ? 'Pending dispatch'
                : '—'}
          </dd>
          <dt>Client IP</dt>
          <dd className="mono">{message.clientIp || '—'}</dd>
        </dl>
      </div>

      {message.authResults && (
        <div className="card">
          <h3 className="section-title">Authentication (SPF / DKIM / DMARC)</h3>
          <dl className="detail-grid">
            <dt>Mode</dt>
            <dd>{message.authResults.mode}</dd>
            <dt>Overall</dt>
            <dd>
              <span className={message.authResults.overall === 'pass' ? 'badge badge-ok' : 'badge'}>
                {message.authResults.overall}
              </span>
            </dd>
            <dt>SPF</dt>
            <dd>
              {message.authResults.spf.result}
              {message.authResults.spf.domain ? ` (${message.authResults.spf.domain})` : ''}
            </dd>
            <dt>DKIM</dt>
            <dd>
              {message.authResults.dkim.result}
              {message.authResults.dkim.domains?.length
                ? ` — ${message.authResults.dkim.domains.join(', ')}`
                : ''}
            </dd>
            <dt>DMARC</dt>
            <dd>
              {message.authResults.dmarc.result}
              {message.authResults.dmarc.policy ? ` (policy: ${message.authResults.dmarc.policy})` : ''}
            </dd>
            <dt>Summary</dt>
            <dd className="mono small">{message.authResults.summary}</dd>
            <dt>Checked</dt>
            <dd>{new Date(message.authResults.checkedAt).toLocaleString()}</dd>
          </dl>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Participants</h3>
        <dl className="detail-grid">
          <dt>From</dt>
          <dd>{formatAddresses([message.from])}</dd>
          <dt>To</dt>
          <dd>{formatAddresses(message.to)}</dd>
          <dt>Cc</dt>
          <dd>{formatAddresses(message.cc)}</dd>
          <dt>Reply-To</dt>
          <dd>{formatAddresses(message.replyTo)}</dd>
        </dl>
      </div>

      {message.textBody && (
        <div className="card">
          <h3 className="section-title">Text body</h3>
          <pre className="pre-block body-preview">{message.textBody}</pre>
        </div>
      )}

      {message.htmlBody && (
        <div className="card">
          <h3 className="section-title">HTML body</h3>
          <pre className="pre-block body-preview">{message.htmlBody.slice(0, 8000)}</pre>
          {message.htmlBody.length > 8000 && (
            <p className="muted">Truncated — full HTML stored in MongoDB.</p>
          )}
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Attachments ({message.attachments?.length ?? 0})</h3>
        {!message.attachments?.length ? (
          <p className="muted">No attachments</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th>Size</th>
                <th>Disposition</th>
                <th>Content-ID</th>
                <th>OCI path</th>
              </tr>
            </thead>
            <tbody>
              {message.attachments.map((a) => (
                <tr key={a._id}>
                  <td>{a.filename}</td>
                  <td>{a.mimeType}</td>
                  <td>{formatBytes(a.size)}</td>
                  <td>{a.contentDisposition || '—'}</td>
                  <td className="mono small">{a.contentId || '—'}</td>
                  <td className="mono small">{a.storagePath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Headers</h3>
        <pre className="pre-block">
          {Object.entries(message.headers || {})
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('\n') || '—'}
        </pre>
      </div>
    </>
  );
}
