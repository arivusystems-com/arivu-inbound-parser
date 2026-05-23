import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson } from '../api';

interface Stats {
  messagesTotal: number;
  messagesFailed: number;
  queues: Record<string, { waiting: number; active: number; failed: number; completed: number }>;
  lastMessage: { _id: string; subject: string; receivedAt: string } | null;
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Stats>('/admin/stats')
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  const waiting = Object.values(stats.queues).reduce((n, q) => n + q.waiting, 0);

  return (
    <>
      <h2>Dashboard</h2>
      <div className="grid">
        <div className="card">
          <div className="muted">Messages</div>
          <div className="stat">{stats.messagesTotal}</div>
        </div>
        <div className="card">
          <div className="muted">Failed</div>
          <div className="stat">{stats.messagesFailed}</div>
        </div>
        <div className="card">
          <div className="muted">Queue waiting</div>
          <div className="stat">{waiting}</div>
        </div>
      </div>
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
