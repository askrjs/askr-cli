import { route } from '@askrjs/askr/router';
import LoginPage from './login';

export function registerAuthRoutes(): void {
  route('/login', LoginPage);
}
