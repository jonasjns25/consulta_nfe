/**
 * Limitador local de consultas NFeConsultaProtocolo por chave (10/h) e bloqueio pós-656 (60 min).
 */
const fs = require('fs');
const path = require('path');

const JANELA_MS = 60 * 60 * 1000;
const MAX_POR_CHAVE = 10;
const BLOQUEIO_656_MS = 60 * 60 * 1000;

const DEFAULT_PATH = path.join(__dirname, '..', '.sefaz-consulta-limiter.json');

function agoraMs() {
    return Date.now();
}

function lerArquivo(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_e) {
        return { porChave: {}, bloqueios: {} };
    }
}

function gravarArquivo(filePath, estado) {
    fs.writeFileSync(filePath, JSON.stringify(estado, null, 0));
}

function limparExpirados(estado, now) {
    const porChave = estado.porChave || {};
    for (const ch of Object.keys(porChave)) {
        porChave[ch] = (porChave[ch] || []).filter((t) => now - t < JANELA_MS);
        if (!porChave[ch].length) delete porChave[ch];
    }
    const bloqueios = estado.bloqueios || {};
    for (const k of Object.keys(bloqueios)) {
        if (now >= Number(bloqueios[k])) delete bloqueios[k];
    }
    estado.porChave = porChave;
    estado.bloqueios = bloqueios;
    return estado;
}

function chaveBloqueio656(chave, cnpj) {
    const c = String(chave || '').replace(/\D/g, '');
    const j = String(cnpj || '').replace(/\D/g, '').slice(0, 14);
    return `656:${c}:${j}`;
}

function formatarRetryEm(isoDate) {
    try {
        return new Date(isoDate).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (_e) {
        return isoDate;
    }
}

function criarLimitador(opts = {}) {
    const filePath = opts.filePath || DEFAULT_PATH;

    function lerEstado() {
        return limparExpirados(lerArquivo(filePath), agoraMs());
    }

    function salvar(estado) {
        gravarArquivo(filePath, limparExpirados(estado, agoraMs()));
    }

    /**
     * @returns {{ permitido: boolean, motivo?: string, retryAt?: string, retryAtMs?: number }}
     */
    function podeConsultar(chave, cnpj) {
        const now = agoraMs();
        const estado = lerEstado();
        const ch = String(chave || '').replace(/\D/g, '');
        const bk = chaveBloqueio656(ch, cnpj);
        const exp656 = estado.bloqueios[bk];
        if (exp656 && now < exp656) {
            return {
                permitido: false,
                motivo: 'bloqueio_656',
                retryAtMs: exp656,
                retryAt: new Date(exp656).toISOString(),
            };
        }
        const lista = estado.porChave[ch] || [];
        if (lista.length >= MAX_POR_CHAVE) {
            const maisAntigo = Math.min(...lista);
            const retryAtMs = maisAntigo + JANELA_MS;
            return {
                permitido: false,
                motivo: 'limite_chave',
                retryAtMs,
                retryAt: new Date(retryAtMs).toISOString(),
            };
        }
        return { permitido: true };
    }

    function registrarConsultaRealizada(chave) {
        const ch = String(chave || '').replace(/\D/g, '');
        if (ch.length !== 44) return;
        const estado = lerEstado();
        if (!estado.porChave[ch]) estado.porChave[ch] = [];
        estado.porChave[ch].push(agoraMs());
        salvar(estado);
    }

    function registrarBloqueio656(chave, cnpj) {
        const estado = lerEstado();
        const bk = chaveBloqueio656(chave, cnpj);
        estado.bloqueios[bk] = agoraMs() + BLOQUEIO_656_MS;
        salvar(estado);
        console.warn(`[SEFAZ limiter] Bloqueio 656 registrado até ${formatarRetryEm(estado.bloqueios[bk])} chave=${String(chave).slice(0, 8)}…`);
    }

    return {
        podeConsultar,
        registrarConsultaRealizada,
        registrarBloqueio656,
        MAX_POR_CHAVE,
        JANELA_MS,
        BLOQUEIO_656_MS,
    };
}

module.exports = {
    criarLimitador,
    MAX_POR_CHAVE,
    JANELA_MS,
    BLOQUEIO_656_MS,
    formatarRetryEm,
};
