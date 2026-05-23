import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson } from '../api';

type QueueStats = Record<
  string,
  { waiting: number; active: number; failed: number; completed: number; delayed?: number }
>;

export function QueuesPage() {
  const [queues, setQueues] = useState<QueueStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ queues: QueueStats }>('/admin/queues')
      .then((d) => setQueues(d.queues))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!queues) return <p className="muted">Loading…</p>;

  return (
    <>
      <h2>Queues</h2>
      <p className="muted">
        BullMQ pipeline. Poison messages after max retries appear in{' '}
        <Link to="/dlq">DLQ</Link>.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Queue</th>
              <th>Waiting</th>
              <th>Active</th>
              <th>Delayed</th>
              <th>Completed</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(queues).map(([name, q]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{q.waiting}</td>
                <td>{q.active}</td>
                <td>{q.delayed ?? 0}</td>
                <td>{q.completed}</td>
                <td>{q.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
