import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { confirmDelete, deleteJson, fetchJson, postJson } from '../api';

interface DlqJob {
  id: string;
  data: {
    originalQueue: string;
    error: string;
    failedAt: string;
    attemptsMade: number;
    messageId?: string;
    tenantId?: string;
    mailboxId?: string;
    rawMimePath?: string;
  };
  timestamp: number;
}

export function DlqPage() {
  const [jobs, setJobs] = useState<DlqJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [requeueId, setRequeueId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchJson<{ jobs: DlqJob[] }>('/admin/dlq')
      .then((d) => setJobs(d.jobs))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function requeue(jobId: string) {
    setRequeueId(jobId);
    try {
      await postJson(`/admin/dlq/${jobId}/requeue`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Requeue failed');
    } finally {
      setRequeueId(null);
    }
  }

  async function deleteJob(jobId: string) {
    if (!confirmDelete('Remove this job from the dead letter queue?')) return;
    setDeletingId(jobId);
    try {
      await deleteJson(`/admin/dlq/${jobId}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h2>Dead letter queue</h2>
      <p className="muted">Jobs that exhausted retries. Requeue sends work back to the original queue.</p>
      {loading && <p className="muted">Loading…</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Failed at</th>
              <th>Queue</th>
              <th>Message</th>
              <th>Error</th>
              <th>Attempts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{new Date(job.data.failedAt).toLocaleString()}</td>
                <td className="mono small">{job.data.originalQueue}</td>
                <td>
                  {job.data.messageId ? (
                    <Link to={`/messages/${job.data.messageId}`}>{job.data.messageId}</Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="small">{job.data.error}</td>
                <td>{job.data.attemptsMade}</td>
                <td className="actions-cell">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={requeueId === job.id}
                    onClick={() => requeue(job.id)}
                  >
                    {requeueId === job.id ? '…' : 'Requeue'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={deletingId === job.id}
                    onClick={() => deleteJob(job.id)}
                  >
                    {deletingId === job.id ? '…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && jobs.length === 0 && <p className="muted">DLQ is empty.</p>}
      </div>
    </>
  );
}
