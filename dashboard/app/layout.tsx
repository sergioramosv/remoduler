import './globals.css';
import { Sidebar } from '@/components/Sidebar';

export const metadata = {
  title: 'Remoduler Dashboard',
  description: 'Autonomous AI Agent Orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-theme="dark">
      <body style={{ display: 'flex' }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 220, minHeight: '100vh', transition: 'margin-left 0.2s' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
