import { PageFrame, SiteHeader } from './components/site-shell';

export { navItems } from './components/site-shell';

export default function App({ children }: { children?: unknown }) {
  return (
    <div class="site-shell">
      <SiteHeader />
      <main class="site-main">
        <PageFrame>{children}</PageFrame>
      </main>
    </div>
  );
}
