import { createApp } from './app';
import { createDependencies } from './dependencies';

const app = createApp(createDependencies());

export { app };
export { telemetry } from '../telemetry';
export default app;
