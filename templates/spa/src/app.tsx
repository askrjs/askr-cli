import "./styles.css";
import { MoonIcon, SunIcon } from "@askrjs/askr-lucide";
import { Link } from "@askrjs/askr/router";
import { NavLink } from "@askrjs/askr-ui";
import { ThemeProvider, ThemeToggle } from "@askrjs/askr-themes/components";

export default function App({ children }: { children?: unknown }) {
  return (
    <ThemeProvider defaultTheme="light">
      <div class="marketing-shell">
        <header>
          <nav class="marketing-topbar">
            <Link href="/" class="marketing-brand">
              <span class="marketing-brand-mark">A</span>
              <span class="marketing-brand-copy">
                <strong>{"{{appName}}"}</strong>
              </span>
            </Link>
            <div class="marketing-nav">
              <NavLink href="/">Home</NavLink>
              <NavLink href="/about">About</NavLink>
              <NavLink href="/components">Components</NavLink>
              <NavLink href="/charts">Charts</NavLink>
            </div>
            <div class="marketing-actions">
              <ThemeToggle
                variant="ghost"
                size="icon"
                toggleThemes={["light", "dark"]}
                aria-label="Toggle color theme"
                lightIcon={<SunIcon size={16} aria-hidden="true" />}
                darkIcon={<MoonIcon size={16} aria-hidden="true" />}
              />
            </div>
          </div>
          </nav>
        </header>
        <main class="marketing-section">{children}</main>
      </div>
    </ThemeProvider>
  );
}
