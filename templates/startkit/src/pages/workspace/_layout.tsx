import { Block, Main } from '@askrjs/themes/components';
import AppHeader from '../../components/app-header';
import AppSidebar from '../../components/app-sidebar';

export default function AppLayout(props: { children?: unknown }) {
  return (
    <Block minHeight="screen" rowFrom="lg">
      <div class="app-shell-nav">
        <AppSidebar />
      </div>
      <Main class="app-shell-main">
        <AppHeader />
        <div class="app-main">{props.children}</div>
      </Main>
    </Block>
  );
}
