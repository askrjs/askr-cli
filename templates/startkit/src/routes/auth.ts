import { lazy, route } from '@askrjs/askr/router';

const LoginPage = lazy(() => import('../pages/auth/login'));

export function registerAuthRoutes(): void {
  route('/login', LoginPage);
}
