import { createSPA } from '@askrjs/askr';
import { getRoutes, navigate } from '@askrjs/askr/router';
import '@askrjs/askr-charts';

import './styles.css';

// Import routes (they auto-register)
import './routes';

// Create and start the SPA
createSPA({
  root: document.getElementById('app')!,
  routes: getRoutes(),
});

// Resolve initial route
navigate(window.location.pathname);
