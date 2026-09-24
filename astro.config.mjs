// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Astro ships zero JS by default; only the React workbench island hydrates.
export default defineConfig({
  integrations: [react()],
  site: 'https://mockforge.dev',
  devToolbar: { enabled: false },
});
