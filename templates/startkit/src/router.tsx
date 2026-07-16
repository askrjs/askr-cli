import { createRouteRegistry } from '@askrjs/askr/router';
import { registerAppRoutes } from './routes';
import { routeAuth } from './routes/auth-config';

export const pageRegistry = createRouteRegistry(registerAppRoutes, {
  auth: routeAuth,
});
