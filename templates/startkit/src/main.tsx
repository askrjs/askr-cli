import { createSPA } from '@askrjs/askr/boot';
import { initializeAppSession } from './lib/mock-data';
import { pageRegistry } from './router';

initializeAppSession();

// createSPA is async: it drains lazy() chunks, applies the registry,
// resolves the initial route, and wires history navigation — all in one call.
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element.');

await createSPA({ root, registry: pageRegistry });
