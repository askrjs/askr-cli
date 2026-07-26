import { createSPA } from '@askrjs/askr/boot';

import './styles.css';
import { pageRegistry } from './pages/_routes';

await createSPA({
  root: document.getElementById('app')!,
  registry: pageRegistry,
});
