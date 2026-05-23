import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson } from '../api';

interface Stats {
  messagesTotal: number;
  messagesFailed: number;
  messagesDuplicate?: number;
  messagesProcessed?: number;
  dlqCount?: number;
  queues: Record<
    string,
    { waiting: number; active: number; failed: number; completed: number; delayed?: number }
  >;
  lastMessage: { _id: string; subject: string; receivedAt: string } | null;
}

interface Metrics {
  receivedLast24h: number;
  eventsDispatched: number;
  dlqJobs: number;
  messagesByStatus: Record<string, number>;
  queueRetryPolicy: { maxAttempts: number; backoffMs: number };
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchJson<Stats>('/admin/stats'), fetchJson<Metrics>('/admin/metrics')])
      .then(([s, m]) => {
        setStats(s);
        setMetrics(m);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  const waiting = Object.values(stats.queues).reduce((n, q) => n + q.waiting, 0);
  const delayed = Object.values(stats.queues).reduce((n, q) => n + (q.delayed ?? 0), 0);

  return (
    <>
      <h2>Dashboard</h2>
      <div className="grid">
        <div className="card">
          <div className="muted">Messages</div>
          <div className="stat">{stats.messagesTotal}</div>
        </div>
        <div className="card">
          <div className="muted">Processed</div>
          <div className="stat">{stats.messagesProcessed ?? metrics?.messagesByStatus?.processed ?? 0}</div>
        </div>
        <div className="card">
          <div className="muted">Failed</div>
          <div className="stat">
            <Link to="/failures">{stats.messagesFailed}</Link>
          </div>
        </div>
        <div className="card">
          <div className="muted">Duplicates</div>
          <div className="stat">{stats.messagesDuplicate ?? 0}</div>
        </div>
        <div className="card">
          <div className="muted">DLQ jobs</div>
          <div className="stat">
            <Link to="/dlq">{stats.dlqCount ?? metrics?.dlqJobs ?? 0}</Link>
          </div>
        </div>
        <div className="card">
          <div className="muted">Queue waiting</div>
          <div className="stat">{waiting}</div>
        </div>
        <div className="card">
          <div className="muted">Queue delayed</div>
          <div className="stat">{delayed}</div>
        </div>
        {metrics && (
          <>
            <div className="card">
              <div className="muted">Received (24h)</div>
              <div className="stat">{metrics.receivedLast24h}</div>
            </div>
            <div className="card">
              <div className="muted">CRM events sent</div>
              <div className="stat">{metrics.eventsDispatched}</div>
            </div>
          </>
        )}
      </div>

      {metrics && (
        <div className="card">
          <strong>Retry policy</strong>
          <p className="muted">
            {metrics.queueRetryPolicy.maxAttempts} attempts, exponential backoff from{' '}
            {metrics.queueRetryPolicy.backoffMs}ms
          </p>
        </div>
      )}

      {stats.lastMessage && (
        <div className="card">
          <strong>Last message</strong>
          <p>
            <Link to={`/messages/${stats.lastMessage._id}`}>
              {stats.lastMessage.subject || '(no subject)'}
            </Link>
          </p>
          <p className="muted mono">{stats.lastMessage._id}</p>
        </div>
      )}
    </>
  );
}
