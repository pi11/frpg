import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Final package name must be chosen before the first Play upload (docs/OPEN_QUESTIONS.md).
  appId: 'com.wasteland.game',
  appName: 'Пустошь',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  // Edge-to-edge with the camera cutout: env(safe-area-inset-*) is filled in, see style.css.
  plugins: { SystemBars: { insetsHandling: 'native', initialViewportFitValueHint: 'cover' } },
};

export default config;
