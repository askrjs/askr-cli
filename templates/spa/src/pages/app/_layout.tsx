import {
  BotIcon,
  HomeIcon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from '@askrjs/lucide';
import { Link, navigate } from '@askrjs/askr/router';
import { Button } from '@askrjs/themes/components';
import { Container, Inline, Stack } from '@askrjs/themes/components';
import { Header, Shell, ShellMain, ShellNav } from '@askrjs/themes/components';
import {
  NavBrand,
  NavGroup,
  NavLink,
  Sidebar,
} from '@askrjs/themes/components';
import { Badge } from '@askrjs/themes/components';
import { ThemeToggle } from '@askrjs/themes/theme';
import { appNavItems } from '../../shared/navigation';

const icons = {
  home: <HomeIcon size={16} aria-hidden="true" />,
  agents: <BotIcon size={16} aria-hidden="true" />,
  settings: <SettingsIcon size={16} aria-hidden="true" />,
};

export default function AppLayout({ children }: { children?: unknown }) {
  return (
    <Shell variant="sidebar" class="app-shell">
      <ShellNav>
        <Sidebar
          aria-label="Workspace navigation"
          breakpoint="md"
          collapsible="icon"
        >
          <NavBrand>
            <Link href="/app" class="brand-link">
              <span class="brand-mark">A</span>
              <strong>{'{{appName}}'}</strong>
            </Link>
          </NavBrand>
          <NavGroup label="Workspace">
            {appNavItems.map((item) => (
              <NavLink href={item.href} match={item.match}>
                <Inline as="span" gap="2" align="center">
                  {icons[item.icon]}
                  <span>{item.label}</span>
                </Inline>
              </NavLink>
            ))}
          </NavGroup>
          <NavGroup label="Session" align="end">
            <NavLink href="/" match="exact">
              <Inline as="span" gap="2" align="center">
                <LogOutIcon size={16} aria-hidden="true" />
                <span>Sign out</span>
              </Inline>
            </NavLink>
          </NavGroup>
        </Sidebar>
      </ShellNav>
      <ShellMain>
        <Header position="sticky" class="app-header">
          <Container size="full">
            <Inline justify="between" align="center" gap="3" wrap>
              <Stack gap="none">
                <span class="eyebrow">Operations console</span>
                <strong>Agent workflow control plane</strong>
              </Stack>
              <Inline gap="2" align="center" wrap>
                <Badge>event stream healthy</Badge>
                <ThemeToggle
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle color theme"
                  lightIcon={<SunIcon size={18} aria-hidden="true" />}
                  darkIcon={<MoonIcon size={18} aria-hidden="true" />}
                />
                <Button variant="secondary" onPress={() => navigate('/')}>
                  Public site
                </Button>
              </Inline>
            </Inline>
          </Container>
        </Header>
        <Container size="full" class="app-main">
          {children}
        </Container>
      </ShellMain>
    </Shell>
  );
}
