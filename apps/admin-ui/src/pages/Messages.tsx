import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

interface Message {
  _id: string;
  subject: string;
  from: { address: string };
  processingStatus: string;
  receivedAt: string;
  tenantId: string;
  mailboxId: string;
}

export function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ messages: Message[] }>('/admin/messages')
      .then((d) => setMessages(d.messages))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h2>Messages</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Subject</th>
              <th>From</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {messages.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No messages yet
                </td>
              </tr>
            )}
            {messages.map((m) => (
              <tr key={m._id}>
                <td>{m._id}</td>
                <td>{m.subject || '—'}</td>
                <td>{m.from?.address || '—'}</td>
                <td>{m.processingStatus}</td>
                <td>{new Date(m.receivedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
