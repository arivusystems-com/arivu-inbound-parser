import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

interface Failure {
  _id: string;
  subject: string;
  errorMessage?: string;
  receivedAt: string;
}

export function FailuresPage() {
  const [failures, setFailures] = useState<Failure[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ failures: Failure[] }>('/admin/failures')
      .then((d) => setFailures(d.failures))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h2>Failures</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Subject</th>
              <th>Error</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {failures.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No failures
                </td>
              </tr>
            )}
            {failures.map((f) => (
              <tr key={f._id}>
                <td>{f._id}</td>
                <td>{f.subject || '—'}</td>
                <td>{f.errorMessage || '—'}</td>
                <td>{new Date(f.receivedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
