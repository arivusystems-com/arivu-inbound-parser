import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { confirmDelete, deleteJson, fetchJson, postJson } from '../api';

interface Failure {
  _id: string;
  subject: string;
  processingStatus: string;
  errorMessage?: string;
  receivedAt: string;
}

export function FailuresPage() {
  const [failures, setFailures] = useState<Failure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchJson<{ failures: Failure[] }>('/admin/failures')
      .then((d) => setFailures(d.failures))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function replay(id: string) {
    setReplayingId(id);
    try {
      await postJson(`/admin/failures/${id}/retry`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Replay failed');
    } finally {
      setReplayingId(null);
    }
  }

  async function deleteOne(id: string) {
    if (!confirmDelete('Delete this failed message and its OCI files?')) return;
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

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h2>Failures</h2>
      <p className="muted">
        Failed parses and duplicate RFC Message-IDs. For exhausted queue jobs see{' '}
        <Link to="/dlq">DLQ</Link>.
      </p>
      {loading && <p className="muted">Loading…</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Status</th>
              <th>Error</th>
              <th>Received</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && failures.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No failures — pipeline is healthy.
                </td>
              </tr>
            )}
            {failures.map((f) => (
              <tr key={f._id}>
                <td>
                  <Link to={`/messages/${f._id}`}>{f.subject || '(no subject)'}</Link>
                  <div className="muted mono small">{f._id}</div>
                </td>
                <td>{f.processingStatus}</td>
                <td className="error-cell">{f.errorMessage || '—'}</td>
                <td>{new Date(f.receivedAt).toLocaleString()}</td>
                <td className="actions-cell">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={replayingId === f._id}
                    onClick={() => replay(f._id)}
                  >
                    {replayingId === f._id ? '…' : 'Replay'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={deletingId === f._id}
                    onClick={() => deleteOne(f._id)}
                  >
                    {deletingId === f._id ? '…' : 'Delete'}
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
