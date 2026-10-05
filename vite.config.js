import { defineConfig } from 'vite';
import { ServerCore } from './src/shared/server-core.js';
import { attachGameServer } from './server/attach.js';

// В режиме разработки игровой сервер (WebSocket /ws) работает прямо внутри Vite:
// достаточно `npm run dev`. Тестовые лобби с ботами разрешены.
// Если нужен внешний сервер (npm run server), задайте KONTORKA_EXTERNAL=1 —
// тогда /ws проксируется на localhost:8080.
const EXTERNAL = process.env.KONTORKA_EXTERNAL === '1';

function kontorkaGameServer() {
  return {
    name: 'kontorka-game-server',
    configureServer(server) {
      if (EXTERNAL || !server.httpServer) return;
      const core = new ServerCore({
        dev: true, region: 'Локально', serverName: 'Vite-dev',
        log: (code, e) => { if (e.kind === 'match_end' || e.kind === 'room_start') console.log(`[${code}] ${e.kind}`); },
      });
      const game = attachGameServer(server.httpServer, core);
      server.httpServer.on('close', () => game.close());
      console.log('  ➜  Игровой сервер: WebSocket /ws (режим разработчика, боты разрешены)');
    },
  };
}

export default defineConfig({
  plugins: [kontorkaGameServer()],
  server: {
    host: true,
    port: 5173,
    proxy: EXTERNAL ? { '/ws': { target: 'ws://localhost:8080', ws: true } } : undefined,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
