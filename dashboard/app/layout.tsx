import './globals.css';

export const metadata = {
  title: 'Remoduler Dashboard',
  description: 'Autonomous AI Agent Orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
