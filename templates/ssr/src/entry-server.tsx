import { createServerApp } from '@askrjs/server';
import { createAskrPageHandler } from '@askrjs/server/askr';
import { pageRegistry } from './routes';

const app = createServerApp({
  fallback: createAskrPageHandler({ registry: pageRegistry }),
});

export { app };
export default app;
