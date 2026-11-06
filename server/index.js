import http from 'node:http';
import { createApp, DEMO } from './src/app.js';

const PORT = Number(process.env.PORT || 4780);
// Loopback by default. Docker publishes 127.0.0.1:<port> on the host only, so the container may widen its own
// bind to 0.0.0.0; the Host allow-list still refuses every name but the published loopback hosts.
const BIND = process.env.LAB_BIND === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';

const app = createApp({ port: PORT });
const server = http.createServer(app);
server.listen(PORT, BIND, () => {
  console.log(`[${DEMO.id}] listening on http://${BIND}:${PORT} (loopback only)`);
});

// Keep the process alive on unexpected async failures; log the kind only, never a message (it could carry a secret).
process.on('uncaughtException', (err) => {
  console.error(`[idjag-runner] uncaughtException: ${err?.name || 'Error'}`);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[idjag-runner] unhandledRejection: ${reason?.name || 'Reason'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
