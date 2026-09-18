/**
 * Domínio de situação NF-e a partir de retConsSitNFe (NFeConsultaProtocolo4).
 */

const CSTAT_AUTORIZADA = new Set(['100', '150']);
const CSTAT_CANCELADA = new Set(['101', '151', '155', '135']);
const CSTAT_DENEGADA = new Set(['110', '301', '302', '303']);
const TP_EVENTO_CANCELAMENTO = new Set(['110111', '110112']);

function textoCampo(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return String(v['#text'] ?? v._text ?? '').trim();
    return String(v).trim();
}

function temEventoCancelamento(eventos) {
    return (eventos || []).some((e) => TP_EVENTO_CANCELAMENTO.has(String(e.tpEvento || '')));
}

function temCce(eventos) {
    return (eventos || []).some((e) => String(e.tpEvento) === '110110');
}

function situacaoDominioDeCstat(cStatRet, cStatProt, eventos) {
    const eventosLista = eventos || [];
    if (temEventoCancelamento(eventosLista)) {
        return { situacao: 'cancelada', label: 'Cancelado', cancelada: true, denegada: false, autorizada: false };
    }
    const c = String(cStatProt || cStatRet || '').trim();
    if (CSTAT_CANCELADA.has(c)) {
        return { situacao: 'cancelada', label: 'Cancelado', cancelada: true, denegada: false, autorizada: false };
    }
    if (CSTAT_DENEGADA.has(c)) {
        return { situacao: 'denegada', label: 'Denegado', cancelada: false, denegada: true, autorizada: false };
    }
    if (CSTAT_AUTORIZADA.has(c)) {
        return { situacao: 'autorizada', label: 'Autorizado', cancelada: false, denegada: false, autorizada: true };
    }
    if (c === '217') {
        return {
            situacao: 'nao_encontrada',
            label: 'Não consta na SEFAZ',
            cancelada: false,
            denegada: false,
            autorizada: false,
        };
    }
    if (c === '226') {
        return {
            situacao: 'erro_roteamento',
            label: 'UF divergente do webservice',
            cancelada: false,
            denegada: false,
            autorizada: false,
        };
    }
    if (c === '656') {
        return {
            situacao: 'consumo_indevido',
            label: 'Consumo indevido (limite SEFAZ)',
            cancelada: false,
            denegada: false,
            autorizada: false,
        };
    }
    return {
        situacao: 'indefinida',
        label: c ? `cStat ${c}` : 'Indefinida',
        cancelada: false,
        denegada: false,
        autorizada: false,
    };
}

function montarStatusDeRetConsSitNFe(ret, infProt, eventosExtra, chave, cnpj) {
    const cStatRet = textoCampo(ret && ret.cStat);
    const xMotivoRet = textoCampo(ret && ret.xMotivo);
    const inf = infProt || {};
    const cStatProt = textoCampo(inf.cStat);
    const xMotivoProt = textoCampo(inf.xMotivo);
    const eventos = eventosExtra && eventosExtra.eventos ? eventosExtra.eventos : [];
    const ambiente = eventosExtra && eventosExtra.ambiente ? eventosExtra.ambiente : '';
    const dominio = situacaoDominioDeCstat(cStatRet, cStatProt, eventos);
    const cStat = cStatRet || cStatProt || '';
    const xMotivo = xMotivoRet || xMotivoProt || '';
    const nProt = textoCampo(inf.nProt);
    const dhRecbto = textoCampo(inf.dhRecbto);

    let detalhe = null;
    if (cStat === '217') detalhe = 'NF-e não consta na base de dados da SEFAZ.';
    else if (cStat === '226') detalhe = 'UF da chave diverge do webservice consultado (verifique roteamento por cUF).';
    else if (cStat === '656') detalhe = xMotivo || 'Consumo indevido na SEFAZ.';
    else if (nProt) detalhe = `Protocolo ${nProt}${dhRecbto ? ` · recebimento ${dhRecbto}` : ''}`;

    return {
        chave,
        cnpj,
        ...dominio,
        cStat: cStat || null,
        xMotivo: xMotivo || null,
        nProt: nProt || null,
        dhRecbto: dhRecbto || null,
        detalhe,
        origemDeteccao: 'consulta_protocolo',
        eventos,
        ambiente,
        temCce: temCce(eventos) || Boolean(eventosExtra && eventosExtra.temCce),
    };
}

class ErroConsultaSefazProtocolo extends Error {
    constructor(mensagem, opts = {}) {
        super(mensagem);
        this.name = 'ErroConsultaSefazProtocolo';
        this.codigo = opts.codigo || 'SEFAZ';
        this.cStat = opts.cStat || null;
        this.bloqueio656 = Boolean(opts.bloqueio656);
    }
}

module.exports = {
    CSTAT_AUTORIZADA,
    CSTAT_CANCELADA,
    CSTAT_DENEGADA,
    situacaoDominioDeCstat,
    montarStatusDeRetConsSitNFe,
    temEventoCancelamento,
    ErroConsultaSefazProtocolo,
    textoCampo,
};
