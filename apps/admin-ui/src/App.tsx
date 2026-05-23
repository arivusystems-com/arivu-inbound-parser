import { NavLink, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/Dashboard';
import { MessagesPage } from './pages/Messages';
import { MessageDetailPage } from './pages/MessageDetail';
import { FailuresPage } from './pages/Failures';
import { QueuesPage } from './pages/Queues';
import { MailboxesPage } from './pages/Mailboxes';
import { LogsPage } from './pages/Logs';
import { DlqPage } from './pages/Dlq';

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/messages', label: 'Messages' },
  { to: '/failures', label: 'Failures' },
  { to: '/dlq', label: 'DLQ' },
  { to: '/queues', label: 'Queues' },
  { to: '/mailboxes', label: 'Mailboxes' },
  { to: '/logs', label: 'Logs' },
];

export function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Arivu Inbound Parser</h1>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:id" element={<MessageDetailPage />} />
          <Route path="/failures" element={<FailuresPage />} />
          <Route path="/dlq" element={<DlqPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/mailboxes" element={<MailboxesPage />} />
          <Route path="/logs" element={<LogsPage />} />
        </Routes>
      </main>
    </div>
  );
}
