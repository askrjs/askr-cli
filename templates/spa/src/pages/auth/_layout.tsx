import { Link } from '@askrjs/askr/router';
import { MoonIcon, SunIcon } from '@askrjs/lucide';
import { Block, Button } from '@askrjs/themes/components';
import { Container } from '@askrjs/themes/components';
import { Header } from '@askrjs/themes/components';
import { ThemeToggle } from '@askrjs/themes/theme';

export default function AuthLayout({ children }: { children?: unknown }) {
  return (
    <div class="auth-shell">
      <Header position="sticky" class="auth-header">
        <Container size="full">
          <Block direction="row" justify="between" align="center" gap="md" wrap>
            <Link href="/" class="brand-link">
              <span class="brand-mark">A</span>
              <strong>{'{{appName}}'}</strong>
            </Link>
            <Block direction="row" gap="sm" align="center" wrap>
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
            </Block>
          </Block>
        </Container>
      </Header>
      <main class="auth-main">
        <Container size="sm">{children}</Container>
      </main>
    </div>
  );
}
