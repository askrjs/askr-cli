import { route } from '@askrjs/askr/router';
import HomePage from './home';
// askr:imports

export function registerPublicRoutes(): void {
  // askr:routes
  route('/', HomePage);
}
