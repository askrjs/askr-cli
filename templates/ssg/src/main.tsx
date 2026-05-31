import './styles.css';
import { createSPA } from '@askrjs/askr/boot';
import { getManifest, registerRoutes } from '@askrjs/askr/router';
import { registerAppRoutes } from './routes';

registerRoutes(registerAppRoutes);

await createSPA({
  root: document.getElementById('app')!,
  manifest: getManifest(),
});
