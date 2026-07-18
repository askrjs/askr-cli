import { route } from '@askrjs/askr/router';
import AgentRunsPage from './agent-runs';
import AdminHomePage from './admin-home';
import SettingsPage from './settings';
// askr:imports

export function registerAppRoutes(): void {
  // askr:routes
  route('/app', AdminHomePage);
  route('/app/agents', AgentRunsPage);
  route('/app/settings', SettingsPage);
}
