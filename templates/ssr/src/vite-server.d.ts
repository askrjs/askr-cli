declare module 'virtual:askr-server' {
  import type { ServerApp } from '@askrjs/server';

  const app: ServerApp;
  export { app };
  export default app;
}
