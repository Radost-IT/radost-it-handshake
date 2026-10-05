import { themeQuartz } from 'ag-grid-community';

// The grid reads the site's color tokens, so it follows the light and dark themes.
export const gridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--ink)',
  borderColor: 'var(--line)',
  headerBackgroundColor: 'var(--canvas)',
  headerTextColor: 'var(--muted)',
  accentColor: 'var(--accent)',
  browserColorScheme: 'inherit',
  fontFamily: 'inherit',
  wrapperBorderRadius: 20,
});
