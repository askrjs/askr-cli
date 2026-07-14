import { listen } from '@askrjs/node';
import app from 'virtual:askr-server';

const port = Number(process.env.PORT ?? 3000);
const server = await listen(app, {
  host: process.env.HOST ?? '127.0.0.1',
  port,
});
const address = server.address();
const boundPort = typeof address === 'object' && address ? address.port : port;

console.log(`Server started at http://127.0.0.1:${boundPort}`);

const shutdown = () => server.close();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
