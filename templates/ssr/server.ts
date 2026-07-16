import { serve } from '@askrjs/node';
import app from 'virtual:askr-server';

const port = Number(process.env.PORT ?? 3000);
const running = await serve(app, {
  host: process.env.HOST ?? '127.0.0.1',
  port,
  assets: { root: new URL('./dist', import.meta.url).pathname },
});
console.log(`Server started at ${running.url}`);
