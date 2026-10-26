'use strict';

/** Arquivos exigidos por server.js / sefaz-service.js (deploy incompleto = crash imediato). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OBRIGATORIOS = [
    'lib/sefaz-nfe-consulta-protocolo-urls.js',
    'lib/sefaz-situacao-protocolo.js',
    'lib/sefaz-consulta-limiter.js',
];

const faltando = OBRIGATORIOS.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
if (faltando.length) {
    console.error('[ERRO] Instalacao incompleta. Arquivos ausentes:');
    faltando.forEach((f) => console.error('  - ' + f));
    console.error('');
    console.error('Use atualizar_agora.bat (release GitHub) ou copie a pasta lib/ do repositorio.');
    process.exit(1);
}
console.log('[OK] Modulos lib/ presentes.');
process.exit(0);
