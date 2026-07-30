import { lazy, route } from '@askrjs/askr/router';

const HomePage = lazy(() => import('../pages/home'));

export function registerPublicRoutes(): void {
  route('/', HomePage);
}
