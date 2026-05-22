import { MoonIcon, SunIcon } from "@askrjs/lucide";
import { Link } from "@askrjs/askr/router";
import { Button } from "@askrjs/themes/controls";
import { Container, Inline } from "@askrjs/themes/layouts";
import { Header } from "@askrjs/themes/shells";
import { NavBrand, NavGroup, Navbar, NavLink } from "@askrjs/themes/navs";
import { ThemeToggle } from "@askrjs/themes/theme";

export default function PublicLayout({ children }: { children?: unknown }) {
  return (
    <>
      <Header position="sticky">
        <Container>
          <Navbar aria-label="Public navigation" breakpoint="md">
            <NavBrand>
              <Link href="/" class="brand-link">
                <span class="brand-mark">A</span>
                <strong>{"{{appName}}"}</strong>
              </Link>
            </NavBrand>
            <NavGroup align="center">
              <NavLink href="/" match="exact">
                Overview
              </NavLink>
              <NavLink href="/admin-login">Admin login</NavLink>
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
                  <Link href="/admin-login">Open console</Link>
                </Button>
              </Inline>
            </NavGroup>
          </Navbar>
        </Container>
      </Header>
      <main>{children}</main>
    </>
  );
}
