/**
 * Atualizador automatico do Consulta NF-e.
 *
 * Fluxo:
 *  1. Le a versao instalada em package.json.
 *  2. Consulta a release mais recente no GitHub (API publica - sem auth).
 *  3. Se a versao remota for maior (semver), baixa o asset .zip da release.
 *  4. Faz backup da instalacao atual em ./backups/<versao>-<timestamp>/.
 *  5. Extrai o zip por cima, preservando .env, node_modules, logs e backups.
 *  6. Roda npm install --omit=dev se package.json mudou.
 *  7. Encerra o processo com exit code 75. O servico Windows (nssm) reinicia.
 *
 * Variaveis de ambiente:
 *   UPDATE_REPO_OWNER   -> dono do repositorio (ex: "minhaempresa")
 *   UPDATE_REPO_NAME    -> nome do repositorio (ex: "consulta_nfe")
 *   UPDATE_ASSET_NAME   -> nome do asset .zip dentro da release (opcional;
 *                          padrao = "consulta_nfe.zip"). Se nao encontrar,
 *                          usa o primeiro asset .zip da release.
 *   UPDATE_TOKEN        -> token do GitHub se o repo for privado (opcional)
 *   UPDATE_AUTO         -> "true" para auto-update no boot (padrao: true)
 *   UPDATE_INTERVAL_H   -> intervalo em horas entre checagens (padrao: 6)
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const { execSync, spawn } = require('child_process');
const semver = require('semver');
const AdmZip = require('adm-zip');

const ROOT = __dirname;
const PRESERVE = new Set([
    '.env',
    'node_modules',
    'logs',
    'backups',
    'nssm',
    'dist',
    '.git',
    '.gitignore'
]);

function lerVersaoLocal() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        return pkg.version || '0.0.0';
    } catch (e) {
        return '0.0.0';
    }
}

function httpsGetJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const opts = {
            headers: {
                'User-Agent': 'consulta-nfe-updater',
                'Accept': 'application/vnd.github+json',
                ...headers
            }
        };
        https.get(url, opts, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(httpsGetJson(res.headers.location, headers));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} em ${url}`));
            }
            let raw = '';
            res.on('data', (chunk) => (raw += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error(`Resposta nao JSON de ${url}: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

function baixarArquivo(url, destino, headers = {}) {
    return new Promise((resolve, reject) => {
        const opts = {
            headers: {
                'User-Agent': 'consulta-nfe-updater',
                'Accept': 'application/octet-stream',
                ...headers
            }
        };
        const file = fs.createWriteStream(destino);
        https.get(url, opts, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlink(destino, () => {});
                return resolve(baixarArquivo(res.headers.location, destino, headers));
            }
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(destino, () => {});
                return reject(new Error(`HTTP ${res.statusCode} ao baixar ${url}`));
            }
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (err) => {
            file.close();
            fs.unlink(destino, () => {});
            reject(err);
        });
    });
}

async function copiarPasta(origem, destino) {
    await fsp.mkdir(destino, { recursive: true });
    const entradas = await fsp.readdir(origem, { withFileTypes: true });
    for (const entrada of entradas) {
        const src = path.join(origem, entrada.name);
        const dst = path.join(destino, entrada.name);
        if (entrada.isDirectory()) {
            await copiarPasta(src, dst);
        } else if (entrada.isFile()) {
            await fsp.copyFile(src, dst);
        }
    }
}

async function backupAtual(versaoAtual) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dirBackup = path.join(ROOT, 'backups', `${versaoAtual}_${ts}`);
    await fsp.mkdir(dirBackup, { recursive: true });

    const entradas = await fsp.readdir(ROOT, { withFileTypes: true });
    for (const entrada of entradas) {
        if (PRESERVE.has(entrada.name)) continue;
        if (entrada.name === 'backups') continue;
        const src = path.join(ROOT, entrada.name);
        const dst = path.join(dirBackup, entrada.name);
        if (entrada.isDirectory()) {
            await copiarPasta(src, dst);
        } else if (entrada.isFile()) {
            await fsp.copyFile(src, dst);
        }
    }
    return dirBackup;
}

async function aplicarZip(caminhoZip) {
    const zip = new AdmZip(caminhoZip);
    const entradas = zip.getEntries();

    let prefixoComum = null;
    const nomesRaiz = new Set();
    for (const e of entradas) {
        const partes = e.entryName.split('/').filter(Boolean);
        if (partes.length > 0) nomesRaiz.add(partes[0]);
    }
    if (nomesRaiz.size === 1) {
        prefixoComum = [...nomesRaiz][0] + '/';
    }

    for (const entrada of entradas) {
        let nomeRelativo = entrada.entryName;
        if (prefixoComum && nomeRelativo.startsWith(prefixoComum)) {
            nomeRelativo = nomeRelativo.slice(prefixoComum.length);
        }
        if (!nomeRelativo) continue;

        const primeiraParte = nomeRelativo.split('/')[0];
        if (PRESERVE.has(primeiraParte)) continue;

        const destino = path.join(ROOT, nomeRelativo);
        if (entrada.isDirectory) {
            await fsp.mkdir(destino, { recursive: true });
        } else {
            await fsp.mkdir(path.dirname(destino), { recursive: true });
            await fsp.writeFile(destino, entrada.getData());
        }
    }
}

function rodarNpmInstall() {
    try {
        console.log('[UPDATER] Executando npm install --omit=dev...');
        execSync('npm install --omit=dev --no-audit --no-fund', {
            cwd: ROOT,
            stdio: 'inherit',
            shell: true
        });
    } catch (e) {
        console.error('[UPDATER] Falha no npm install:', e.message);
    }
}

async function obterReleaseRemota() {
    const owner = process.env.UPDATE_REPO_OWNER;
    const repo = process.env.UPDATE_REPO_NAME;
    if (!owner || !repo) {
        throw new Error('UPDATE_REPO_OWNER e UPDATE_REPO_NAME nao configurados no .env');
    }
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const headers = {};
    if (process.env.UPDATE_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.UPDATE_TOKEN}`;
    }
    return httpsGetJson(url, headers);
}

function escolherAsset(release) {
    const nomePreferido = process.env.UPDATE_ASSET_NAME || 'consulta_nfe.zip';
    const assets = release.assets || [];
    return (
        assets.find((a) => a.name === nomePreferido) ||
        assets.find((a) => a.name.toLowerCase().endsWith('.zip')) ||
        null
    );
}

async function verificarEAtualizar({ forcar = false } = {}) {
    const versaoLocal = lerVersaoLocal();
    console.log(`[UPDATER] Versao instalada: ${versaoLocal}`);

    let release;
    try {
        release = await obterReleaseRemota();
    } catch (e) {
        console.error('[UPDATER] Nao foi possivel consultar release remota:', e.message);
        return { atualizado: false, motivo: e.message };
    }

    const tag = (release.tag_name || '').replace(/^v/i, '');
    const versaoRemota = semver.valid(tag) || semver.coerce(tag)?.version;
    if (!versaoRemota) {
        console.error(`[UPDATER] Tag de release invalida: ${release.tag_name}`);
        return { atualizado: false, motivo: 'tag invalida' };
    }
    console.log(`[UPDATER] Versao remota: ${versaoRemota}`);

    if (!forcar && !semver.gt(versaoRemota, versaoLocal)) {
        console.log('[UPDATER] Ja esta na versao mais recente.');
        return { atualizado: false, motivo: 'ja atualizado', versaoLocal, versaoRemota };
    }

    const asset = escolherAsset(release);
    if (!asset) {
        console.error('[UPDATER] Nenhum asset .zip encontrado na release.');
        return { atualizado: false, motivo: 'sem asset zip' };
    }

    console.log(`[UPDATER] Baixando ${asset.name}...`);
    const tmpZip = path.join(ROOT, `update_${Date.now()}.zip`);
    const headersDownload = { Accept: 'application/octet-stream' };
    if (process.env.UPDATE_TOKEN) {
        headersDownload['Authorization'] = `Bearer ${process.env.UPDATE_TOKEN}`;
    }
    await baixarArquivo(asset.browser_download_url, tmpZip, headersDownload);

    console.log('[UPDATER] Fazendo backup da versao atual...');
    const dirBackup = await backupAtual(versaoLocal);
    console.log(`[UPDATER] Backup em: ${dirBackup}`);

    try {
        console.log('[UPDATER] Aplicando arquivos da nova versao...');
        await aplicarZip(tmpZip);
        await fsp.unlink(tmpZip).catch(() => {});

        rodarNpmInstall();

        console.log(`[UPDATER] Atualizacao concluida: ${versaoLocal} -> ${versaoRemota}`);
        return { atualizado: true, versaoLocal, versaoRemota, backup: dirBackup };
    } catch (e) {
        console.error('[UPDATER] FALHA na atualizacao:', e.message);
        console.error('[UPDATER] Restaurando backup...');
        try {
            await copiarPasta(dirBackup, ROOT);
            console.error('[UPDATER] Backup restaurado.');
        } catch (e2) {
            console.error('[UPDATER] FALHA ao restaurar backup:', e2.message);
        }
        return { atualizado: false, motivo: e.message };
    }
}

function reiniciarProcesso() {
    console.log('[UPDATER] Reiniciando processo em 2s...');
    setTimeout(() => process.exit(75), 2000);
}

async function agendarVerificacoes(intervalHoras) {
    const ms = Math.max(1, Number(intervalHoras) || 6) * 60 * 60 * 1000;
    setInterval(async () => {
        try {
            const r = await verificarEAtualizar();
            if (r.atualizado) reiniciarProcesso();
        } catch (e) {
            console.error('[UPDATER] Erro na verificacao periodica:', e.message);
        }
    }, ms);
}

async function executarNoBoot() {
    if (String(process.env.UPDATE_AUTO || 'true').toLowerCase() !== 'true') {
        console.log('[UPDATER] Auto-update desativado (UPDATE_AUTO=false).');
        return false;
    }
    if (!process.env.UPDATE_REPO_OWNER || !process.env.UPDATE_REPO_NAME) {
        console.log('[UPDATER] Configuracao de update ausente. Pulando verificacao.');
        return false;
    }
    const r = await verificarEAtualizar();
    return r.atualizado;
}

module.exports = {
    verificarEAtualizar,
    executarNoBoot,
    agendarVerificacoes,
    reiniciarProcesso,
    lerVersaoLocal
};

if (require.main === module) {
    require('dotenv').config();
    const forcar = process.argv.includes('--force');
    verificarEAtualizar({ forcar })
        .then((r) => {
            console.log('[UPDATER] Resultado:', r);
            process.exit(r.atualizado ? 0 : 1);
        })
        .catch((e) => {
            console.error('[UPDATER] Erro fatal:', e);
            process.exit(2);
        });
}
