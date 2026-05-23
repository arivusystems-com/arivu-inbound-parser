import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../api';

interface LogLine {
  time?: string;
  level?: string;
  name?: string;
  msg?: string;
  messageId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

export function LogsPage() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [note, setNote] = useState('');
  const [logFile, setLogFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState('');
  const [messageId, setMessageId] = useState('');
  const [service, setService] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('limit', '200');
    if (level) params.set('level', level);
    if (messageId) params.set('messageId', messageId);
    if (service) params.set('service', service);

    fetchJson<{ logs: LogLine[]; note?: string; logFile: string | null }>(
      `/admin/logs?${params.toString()}`,
    )
      .then((d) => {
        setLogs(d.logs);
        setNote(d.note ?? '');
        setLogFile(d.logFile);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [level, messageId, service]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <h2>Logs</h2>
      <div className="card filters">
        <label>
          Level{' '}
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All</option>
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
            <option value="debug">debug</option>
          </select>
        </label>
        <label>
          Service{' '}
          <input
            type="text"
            placeholder="smtp-server"
            value={service}
            onChange={(e) => setService(e.target.value)}
          />
        </label>
        <label>
          Message ID{' '}
          <input
            type="text"
            placeholder="msg_..."
            value={messageId}
            onChange={(e) => setMessageId(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={load}>
          Search
        </button>
      </div>

      {logFile && <p className="muted mono small">Source: {logFile}</p>}
      {note && <p className="muted">{note}</p>}
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      <div className="card">
        {!loading && logs.length === 0 ? (
          <p className="muted">No log lines match filters.</p>
        ) : (
          <pre className="pre-block log-viewer">
            {logs.map((line, i) => (
              <div key={i} className={`log-line log-${line.level ?? 'info'}`}>
                {line.time ? `[${line.time}] ` : ''}
                {line.level ? `${line.level} ` : ''}
                {line.name ? `(${line.name}) ` : ''}
                {line.msg ?? JSON.stringify(line)}
                {line.messageId ? ` messageId=${line.messageId}` : ''}
              </div>
            ))}
          </pre>
        )}
      </div>
    </>
  );
}
