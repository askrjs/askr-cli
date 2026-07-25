import { lazy, route } from '@askrjs/askr/router';
import { landingRoute } from '../lib/routes';

export function registerPublicRoutes(): void {
  route(
    landingRoute.href,
    lazy(() => import('../pages/home'))
  );
}
