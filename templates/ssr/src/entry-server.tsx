import { createAskrApp } from '@askrjs/server/askr';
import { pageRegistry } from './routes';

const app = createAskrApp({
  name: '{{appName}}',
  version: '0.1.0',
  dependencies: undefined,
  pages: pageRegistry,
});

export { app };
export default app;
