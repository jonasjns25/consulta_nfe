/**
 * Gera dist/consulta_nfe.zip a partir de scripts/release-manifest.json
 * (mesma lista usada pelo gerar_release.ps1 e pelo GitHub Actions).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'consulta_nfe.zip');
const MANIFEST = path.join(__dirname, 'release-manifest.json');

function falhaSensivel(rel, motivo) {
    console.error(`[pack-release] BLOQUEADO: ${motivo} — "${rel}"`);
    process.exit(1);
}

function verificarNomeArquivo(rel, arquivo) {
    const name = arquivo;
    const lower = String(name).toLowerCase();
    if (lower === '.env' || name.startsWith('.env') || lower.endsWith('.env')) {
        falhaSensivel(rel, 'variavel de ambiente');
    }
    if (lower === 'config.env' || lower === 'credentials.json') {
        falhaSensivel(rel, 'credencial');
    }
    if (/\.(pfx|p12)$/i.test(lower)) falhaSensivel(rel, 'certificado');
}

const files = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
if (!Array.isArray(files) || files.length === 0) {
    console.error('[pack-release] Manifest vazio.');
    process.exit(1);
}

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

const zip = new AdmZip();

for (const rel of files) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
        console.warn(`[pack-release] Omitido (nao existe): ${rel}`);
        continue;
    }
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        console.warn(`[pack-release] Pasta nao empacotada recursivemente aqui: ${rel}`);
        continue;
    }
    verificarNomeArquivo(rel, path.basename(rel));
    zip.addFile(rel, fs.readFileSync(src));
}

zip.writeZip(OUT);
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`[pack-release] OK ${OUT} (${kb} KB)`);
