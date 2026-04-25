import "./styles.css";
import { MoonIcon, SunIcon } from "@askrjs/askr-lucide";
import { Link } from "@askrjs/askr/router";
import { ThemeProvider, ThemeToggle } from "@askrjs/askr-themes/components";

export default function App({ children }: { children?: unknown }) {
  return (
    <ThemeProvider class="app-shell" defaultTheme="light">
      <header>
        <nav>
          <Link href="/">
            <strong>{"{{appName}}"}</strong>
          </Link>
          <div class="nav-actions">
            <div class="nav-links">
              <Link href="/example">Example</Link>
              <Link href="/about">About</Link>
            </div>
            <ThemeToggle
              class="theme-toggle"
              toggleThemes={["light", "dark"]}
              aria-label="Toggle color theme"
              lightIcon={<SunIcon size={16} aria-hidden="true" />}
              darkIcon={<MoonIcon size={16} aria-hidden="true" />}
            />
          </div>
        </nav>
      </header>
      <main>{children}</main>
    </ThemeProvider>
  );
}
