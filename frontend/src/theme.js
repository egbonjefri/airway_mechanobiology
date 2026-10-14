import { useEffect, useState } from 'react';

export const FONT_FAMILY = 'Newsreader, Georgia, serif';

// Canvas drawing can't use CSS variables directly, so read them from :root
const readColors = () => {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    background: read('--bg'),
    text: read('--text'),
    muted: read('--muted'),
    line: read('--line'),
    node: read('--node'),
    cell: read('--cell'),
    mucosa: read('--mucosa'),
    muscle: read('--muscle'),
    cartilage: read('--cartilage'),
    adventitia: read('--adventitia'),
  };
};

/** Theme colours for canvas drawing, updated when the colour scheme changes or fonts load. */
export function useThemeColors() {
  const [colors, setColors] = useState(readColors);

  useEffect(() => {
    const update = () => setColors(readColors());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    // Redraw once Newsreader is ready so canvas labels don't stay in the fallback font
    document.fonts?.ready.then(update);
    return () => media.removeEventListener('change', update);
  }, []);

  return colors;
}

/** Size a canvas for the screen's pixel density and return a cleared context in CSS pixels. */
export function setupCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
