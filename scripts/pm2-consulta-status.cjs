'use strict';

/** Verifica se o app consulta-nfe está online no PM2; exit 1 se parado/erro. */
const { execSync } = require('child_process');

try {
    const raw = execSync('pm2 jlist', { encoding: 'utf8' });
    const apps = JSON.parse(raw);
    const app = apps.find((a) => a.name === 'consulta-nfe');
    if (!app) {
        console.error('[ERRO] PM2: processo "consulta-nfe" nao encontrado.');
        process.exit(1);
    }
    const status = app.pm2_env?.status || 'desconhecido';
    if (status !== 'online') {
        console.error(`[ERRO] PM2: consulta-nfe esta "${status}" (esperado online).`);
        console.error('--- Ultimas linhas do log ---');
        try {
            execSync('pm2 logs consulta-nfe --lines 25 --nostream', { stdio: 'inherit' });
        } catch (_) {
            /* ignora */
        }
        process.exit(1);
    }
    console.log('[OK] PM2: consulta-nfe online.');
} catch (e) {
    console.error('[ERRO] Falha ao consultar PM2:', e.message);
    process.exit(1);
}
