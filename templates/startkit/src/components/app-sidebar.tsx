import { For } from '@askrjs/askr/control';
import { Link } from '@askrjs/askr/router';
import {
  LayoutDashboardIcon,
  UsersIcon,
  SettingsIcon,
  LayersIcon,
  ShieldCheckIcon,
} from '@askrjs/lucide';
import type { IconProps } from '@askrjs/lucide';
import type { JSXElement } from '@askrjs/askr/foundations';
import { NavBrand, NavGroup, NavLink, Navbar } from '@askrjs/themes/components';
import {
  accountsRoute,
  dashboardRoute,
  landingRoute,
  loginRoute,
  settingsRoute,
} from '../lib/routes';

type NavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => JSXElement;
};

const primaryNav: NavItem[] = [
  {
    href: dashboardRoute.href,
    label: dashboardRoute.navLabel,
    icon: LayoutDashboardIcon,
  },
  {
    href: accountsRoute.href,
    label: accountsRoute.navLabel,
    icon: UsersIcon,
  },
  {
    href: settingsRoute.href,
    label: settingsRoute.navLabel,
    icon: SettingsIcon,
  },
];

const secondaryNav: NavItem[] = [
  { href: landingRoute.href, label: 'Marketing site', icon: LayersIcon },
  { href: loginRoute.href, label: 'Auth entry', icon: ShieldCheckIcon },
];

export default function AppSidebar() {
  return (
    <aside class="app-sidebar" aria-label="Sidebar navigation">
      <Navbar
        orientation="vertical"
        class="app-sidebar-nav"
        aria-label="Sidebar navigation"
      >
        <NavBrand>
          <Link href={dashboardRoute.href} class="sidebar-brand">
            <span class="brand-pill" aria-hidden="true">
              A
            </span>
            <div>
              <p class="sidebar-title">{'{{appName}}'}</p>
              <p class="sidebar-subtitle">Starter Kit</p>
            </div>
          </Link>
        </NavBrand>

        <NavGroup id="workspace-nav-group" label="Workspace">
          <For each={primaryNav} by={(item) => item.href}>
            {(item) => {
              const Icon = item.icon;
              return (
                <NavLink href={item.href}>
                  <Icon size={16} aria-hidden={true} />
                  <span>{item.label}</span>
                </NavLink>
              );
            }}
          </For>
        </NavGroup>

        <NavGroup id="other-nav-group" label="Other" placement="bottom">
          <For each={secondaryNav} by={(item) => item.href}>
            {(item) => {
              const Icon = item.icon;
              return (
                <NavLink href={item.href}>
                  <Icon size={16} aria-hidden={true} />
                  <span>{item.label}</span>
                </NavLink>
              );
            }}
          </For>
        </NavGroup>
      </Navbar>
    </aside>
  );
}
