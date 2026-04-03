// Debug wrapper
import { spawn } from 'child_process';

const child = spawn('npx', ['tsx', 'index.ts'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true
});

child.on('error', (err) => {
    console.error('[PARENT] Failed to start:', err);
});

child.on('exit', (code, signal) => {
    console.error(`[PARENT] Child exited with code ${code}, signal ${signal}`);
});

console.log('[PARENT] Started child process, PID:', child.pid);

// Keep parent alive
setInterval(() => {
    console.log('[PARENT] Heartbeat');
}, 5000);
