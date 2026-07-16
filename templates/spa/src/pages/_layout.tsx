import { ThemeScope } from '@askrjs/themes/theme';

export default function RootLayout({ children }: { children?: unknown }) {
  return (
    <ThemeScope defaultTheme="tabby">
      <div class="app-root">{children}</div>
    </ThemeScope>
  );
}
