import { createStitches } from '@stitches/react';

export const {
  styled,
  css,
  globalCss,
  keyframes,
  getCssText,
  theme,
  createTheme,
  config,
} = createStitches({
  theme: {
    colors: {
      error: '#ff0000',
      warning: 'orange',
      success: '#05ff00',
    },
    fonts: {
      Led: "Led",
    }
  },
});

export const fonts = globalCss({
  '@font-face': [
    {
      fontFamily: 'Led',
      src: `url('./fonts/digital-numbers.ttf') format('truetype')`,
    }
  ],
});
