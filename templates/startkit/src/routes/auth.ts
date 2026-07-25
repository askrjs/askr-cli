import { lazy, route } from '@askrjs/askr/router';
import { loginRoute } from '../lib/routes';

export function registerAuthRoutes(): void {
  route(
    loginRoute.href,
    lazy(() => import('../pages/auth/login'))
  );
}
