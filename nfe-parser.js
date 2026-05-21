'use strict';

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    parseAttributeValue: false,
});

function isoParaAaaammdd(iso) {
    if (!iso) return '';
    return String(iso).substring(0, 10).replace(/-/g, '');
}

/** "2024-01-15T10:30:00-03:00" → "20240115103000" (14 chars) */
function isoParaAaaammddhhmmss(iso) {
    if (!iso) return '';
    const s = String(iso);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return s.replace(/\D/g, '').substring(0, 14);
    return m[1] + m[2] + m[3] + m[4] + m[5] + m[6];
}

/** "2024-01-15T10:30:00-03:00" → "2024-01-15T10:30:00" (19 chars, sem timezone) */
function isoSemTimezone(iso) {
    if (!iso) return '';
    const s = String(iso);
    const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : s.substring(0, 19);
}

/**
 * Extrai os campos da tabela nfe_xml a partir do XML completo (nfeProc).
 * @param {string} xmlString
 * @param {string} cnpjEstabelecimento CNPJ do ESTAB consultante
 * @param {number} idNfeXml  próximo IDNFE_XML (MAX+1)
 * @param {number} nsu       próximo NSU (MAX+1)
 */
function extrairDadosNFe(xmlString, cnpjEstabelecimento, idNfeXml, nsu) {
    const obj = parser.parse(xmlString);
    const proc = obj.nfeProc || obj;
    const nfe = proc.NFe || {};
    const inf = nfe.infNFe || {};
    const ide = inf.ide || {};
    const emit = inf.emit || {};
    const tot = inf.total?.ICMSTot || {};
    const prot = proc.protNFe?.infProt || {};
    const chave = String(inf._Id || '').replace(/^NFe/i, '');

    return {
        IDNFE_XML: idNfeXml,
        NSU: nsu,
        CHAVE: chave,
        RAZAO: String(emit.xNome || '').substring(0, 60),
        TIPONFE: '1',
        ESTAB: cnpjEstabelecimento,
        CNPJ_CPF: String(emit.CNPJ || emit.CPF || ''),
        EMISSAO: isoParaAaaammdd(ide.dhEmi),
        DHRECIBO: isoSemTimezone(prot.dhRecbto),
        VALOR: parseFloat(tot.vNF || 0) || 0,
        TPNF: parseInt(ide.tpNF ?? 1, 10),
        SITNFE: 1,
        SITCONF: 0,
        XML: xmlString,
        STATUS: 'R',
        STATUS_MANIFESTO: '',
        ERRO_MANIFESTO: 0,
        ERRO: 0,
        DATA_CIENCIA: '',
        DATA_MANIFESTO: '',
        PROTOCOLO_MANIFESTO: '',
    };
}

module.exports = { extrairDadosNFe, isoParaAaaammdd, isoParaAaaammddhhmmss, isoSemTimezone };
