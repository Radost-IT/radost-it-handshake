import { themeQuartz } from 'ag-grid-community';

// The grid reads the site's color tokens, so it follows the light and dark themes.
export const gridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--ink)',
  textColor: 'var(--ink)',
  borderColor: 'var(--line)',
  headerBackgroundColor: 'color-mix(in srgb, var(--canvas) 55%, var(--surface))',
  headerTextColor: 'var(--muted)',
  headerFontSize: 11,
  headerFontWeight: 600,
  headerHeight: 44,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: 'transparent',
  columnBorder: false,
  rowBorder: { color: 'var(--line)' },
  rowHeight: 52,
  rowHoverColor: 'color-mix(in srgb, var(--accent) 7%, transparent)',
  oddRowBackgroundColor: 'color-mix(in srgb, var(--ink) 1.5%, transparent)',
  accentColor: 'var(--accent)',
  browserColorScheme: 'inherit',
  fontFamily: 'inherit',
  fontSize: 14,
  cellHorizontalPadding: 20,
  wrapperBorder: { color: 'var(--line)' },
  wrapperBorderRadius: 20,
});
