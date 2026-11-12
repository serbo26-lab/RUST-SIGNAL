import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// В Node-окружении Phaser resolver тянет src/ (с require('phaser3spectorjs') и т.п.).
// Принудительно резолвим 'phaser' в готовый браузерный UMD-бандл dist/phaser.js.
const phaserStub = {
  name: 'phaser-stub',
  enforce: 'pre' as const,
  resolveId: (id: string) => id === 'phaser' ? fileURLToPath(new URL('./node_modules/phaser/dist/phaser.js', import.meta.url)) : null,
};

export default defineConfig({
  plugins: [phaserStub],
  test: { setupFiles: ['./vitest.setup.ts'] },
});
