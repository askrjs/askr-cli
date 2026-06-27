import { MoonIcon, SunIcon } from '@askrjs/lucide';
import { Link } from '@askrjs/askr/router';
import { Button } from '@askrjs/themes/components';
import { Container, Inline } from '@askrjs/themes/components';
import { Header } from '@askrjs/themes/components';
import { NavBrand, NavGroup, Navbar, NavLink } from '@askrjs/themes/components';
import { ThemeToggle } from '@askrjs/themes/theme';

export default function PublicLayout({ children }: { children?: unknown }) {
  return (
    <div class="public-shell">
      <Header position="sticky" class="public-header">
        <Container>
          <Navbar aria-label="Public navigation" breakpoint="md">
            <NavBrand>
              <Link href="/" class="brand-link">
                <span class="brand-mark">A</span>
                <strong>{'{{appName}}'}</strong>
              </Link>
            </NavBrand>
            <NavGroup align="center">
              <NavLink href="/" match="exact">
                Overview
              </NavLink>
              <NavLink href="/login">Sign in</NavLink>
            </NavGroup>
            <NavGroup align="end">
              <Inline gap="2" align="center">
                <ThemeToggle
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle color theme"
                  lightIcon={<SunIcon size={18} aria-hidden="true" />}
                  darkIcon={<MoonIcon size={18} aria-hidden="true" />}
                />
                <Button asChild>
                  <Link href="/login">Open console</Link>
                </Button>
              </Inline>
            </NavGroup>
          </Navbar>
        </Container>
      </Header>
      <main class="public-main">{children}</main>
    </div>
  );
}
