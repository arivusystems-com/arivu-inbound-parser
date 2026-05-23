import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchJson, postJson } from '../api';
import { type MessageDetail, statusClass } from '../types';

function formatAddresses(list: { address: string; name?: string }[]): string {
  if (!list?.length) return '—';
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

export function MessageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [message, setMessage] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);

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
        </div>
      </div>

      {replayMsg && (
        <p className={replayMsg.toLowerCase().includes('fail') ? 'error' : 'success'}>{replayMsg}</p>
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
          <dd>{message.threadId || '—'}</dd>
          <dt>Received</dt>
          <dd>{new Date(message.receivedAt).toLocaleString()}</dd>
        </dl>
      </div>

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
