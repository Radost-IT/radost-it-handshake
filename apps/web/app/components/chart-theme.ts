'use client';

import type { AgChartTheme } from 'ag-charts-community';
import { useEffect, useState } from 'react';

// Charts draw on a canvas, which cannot read CSS variables, so each token is resolved to a
// concrete color through a probe element.
function resolveColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function readChartTheme(): AgChartTheme {
  const ink = resolveColor('--ink');
  const muted = resolveColor('--muted');
  const line = resolveColor('--line');
  return {
    baseTheme: 'ag-default',
    palette: { fills: [resolveColor('--accent')], strokes: [resolveColor('--accent')] },
    params: {
      backgroundColor: 'transparent',
      foregroundColor: ink,
      textColor: ink,
      subtleTextColor: muted,
      axisLineColor: line,
      gridLineColor: line,
      tooltipBackgroundColor: resolveColor('--surface'),
      tooltipTextColor: ink,
      fontFamily: getComputedStyle(document.body).fontFamily,
    },
  };
}

/** The chart theme from the site's color tokens. Null until it has been read in the browser. */
export function useChartTheme(): AgChartTheme | null {
  const [theme, setTheme] = useState<AgChartTheme | null>(null);

  useEffect(() => {
    const update = () => {
      setTheme(readChartTheme());
    };
    update();
    const colorScheme = matchMedia('(prefers-color-scheme: light)');
    colorScheme.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => {
      colorScheme.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);

  return theme;
}
