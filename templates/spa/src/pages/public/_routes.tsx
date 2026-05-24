import { route } from '@askrjs/askr/router';
import HomePage from './home';

export function registerPublicRoutes(): void {
  route('/', HomePage);
}
