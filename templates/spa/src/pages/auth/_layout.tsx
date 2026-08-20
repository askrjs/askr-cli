import { Link } from '@askrjs/askr/router';
import { MoonIcon, SunIcon } from '@askrjs/lucide';
import { Button } from '@askrjs/themes/components';
import { Container, Inline } from '@askrjs/themes/components';
import { Header } from '@askrjs/themes/components';
import { ThemeToggle } from '@askrjs/themes/theme';

export default function AuthLayout({ children }: { children?: unknown }) {
  return (
    <div class="auth-shell">
      <Header position="sticky" class="auth-header">
        <Container size="full">
          <Inline justify="between" align="center" gap="3" wrap>
            <Link href="/" class="brand-link">
              <span class="brand-mark">A</span>
              <strong>{'{{appName}}'}</strong>
            </Link>
            <Inline gap="2" align="center" wrap>
              <ThemeToggle
                variant="ghost"
                size="icon"
                aria-label="Toggle color theme"
                lightIcon={<SunIcon size={18} aria-hidden="true" />}
                darkIcon={<MoonIcon size={18} aria-hidden="true" />}
              />
              <Button variant="secondary" asChild>
                <Link href="/">Back to site</Link>
              </Button>
            </Inline>
          </Inline>
        </Container>
      </Header>
      <main class="auth-main">
        <Container size="sm">{children}</Container>
      </main>
    </div>
  );
}
