import {
  BotIcon,
  HomeIcon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from '@askrjs/lucide';
import { Link, navigate } from '@askrjs/askr/router';
import { Block, Button, Main } from '@askrjs/themes/components';
import { Container, Stack } from '@askrjs/themes/components';
import { Header } from '@askrjs/themes/components';
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
    <Block minHeight="screen" direction="row">
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
              <Block direction="row" as="span" gap="sm" align="center">
                {icons[item.icon]}
                <span>{item.label}</span>
              </Block>
            </NavLink>
          ))}
        </NavGroup>
        <NavGroup label="Session" align="end">
          <NavLink href="/" match="exact">
            <Block direction="row" as="span" gap="sm" align="center">
              <LogOutIcon size={16} aria-hidden="true" />
              <span>Sign out</span>
            </Block>
          </NavLink>
        </NavGroup>
      </Sidebar>
      <Main>
        <Header position="sticky" class="app-header">
          <Container size="full">
            <Block
              direction="row"
              justify="between"
              align="center"
              gap="md"
              wrap
            >
              <Stack>
                <span class="eyebrow">Operations console</span>
                <strong>Agent workflow control plane</strong>
              </Stack>
              <Block direction="row" gap="sm" align="center" wrap>
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
              </Block>
            </Block>
          </Container>
        </Header>
        <Container size="full" class="app-main">
          {children}
        </Container>
      </Main>
    </Block>
  );
}
