import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let runningProcess: ReturnType<typeof spawn> | null = null;

export async function POST(request: Request) {
  const { action, tasks, focus } = await request.json();
  const rootDir = resolve(process.cwd(), '..');

  if (action === 'start') {
    if (runningProcess) {
      return NextResponse.json({ error: 'Already running' }, { status: 409 });
    }

    const args = ['src/index.js', 'run'];
    if (tasks) args.push('-t', String(tasks));
    if (focus) args.push('-f', String(focus));

    runningProcess = spawn('node', args, {
      cwd: rootDir,
      stdio: 'ignore',
      detached: true,
      shell: true,
    });

    runningProcess.unref();

    runningProcess.on('close', () => {
      runningProcess = null;
    });

    return NextResponse.json({ success: true, pid: runningProcess.pid, message: 'Remoduler started' });
  }

  if (action === 'stop' || action === 'pause') {
    // Write command to Firebase — the orchestrator listens for these
    // We use the client-side sendCommand for this since it already works
    return NextResponse.json({ success: true, message: `${action} command sent` });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({
    running: runningProcess !== null,
    pid: runningProcess?.pid || null,
  });
}
