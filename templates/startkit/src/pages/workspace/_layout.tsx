import { Shell, ShellMain, ShellNav } from '@askrjs/themes/components';
import AppHeader from '../../components/app-header';
import AppSidebar from '../../components/app-sidebar';

export default function AppLayout(props: { children?: unknown }) {
  return (
    <Shell variant="sidebar" class="app-shell">
      <ShellNav class="app-shell-nav">
        <AppSidebar />
      </ShellNav>
      <ShellMain class="app-shell-main">
        <AppHeader />
        <div class="app-main">{props.children}</div>
      </ShellMain>
    </Shell>
  );
}
