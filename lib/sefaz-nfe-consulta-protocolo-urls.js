/**
 * URLs NFeConsultaProtocolo4 — UF (cUF) + tpAmb → endpoint.
 * Centralize aqui atualizações de webservice por estado.
 */

const SVRS_CONSULTA_PROT = 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx';
const SVRS_CONSULTA_PROT_HOM = 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx';
const SVAN_CONSULTA_PROT = 'https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx';

const UFS_HOMOLOG_SVRS = ['11', '12', '14', '16', '17', '22', '24', '25', '27', '28', '32', '33', '42', '53'];

const MAP_CONSULTA_PROTOCOLO_PROD = {
    11: SVRS_CONSULTA_PROT,
    12: SVRS_CONSULTA_PROT,
    13: 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
    14: SVRS_CONSULTA_PROT,
    15: SVAN_CONSULTA_PROT,
    16: SVRS_CONSULTA_PROT,
    17: SVRS_CONSULTA_PROT,
    21: SVAN_CONSULTA_PROT,
    22: SVRS_CONSULTA_PROT,
    23: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeConsultaProtocolo4',
    24: SVRS_CONSULTA_PROT,
    25: SVRS_CONSULTA_PROT,
    26: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    27: SVRS_CONSULTA_PROT,
    28: SVRS_CONSULTA_PROT,
    29: 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    31: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    32: SVRS_CONSULTA_PROT,
    33: SVRS_CONSULTA_PROT,
    35: 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
    41: 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
    42: SVRS_CONSULTA_PROT,
    43: 'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    50: 'https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
    51: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
    52: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
    53: SVRS_CONSULTA_PROT,
};

const SOAP_ACTION_CONSULTA_PROTOCOLO =
    'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF';

function cUfDaChave(chave) {
    return String(chave || '').replace(/\D/g, '').slice(0, 2);
}

function urlConsultaProtocoloNFe(chave, tpAmb) {
    const cUF = cUfDaChave(chave);
    if (String(tpAmb) === '2' && UFS_HOMOLOG_SVRS.includes(cUF)) {
        return SVRS_CONSULTA_PROT_HOM;
    }
    return MAP_CONSULTA_PROTOCOLO_PROD[cUF] || SVRS_CONSULTA_PROT;
}

module.exports = {
    SVRS_CONSULTA_PROT,
    SVRS_CONSULTA_PROT_HOM,
    MAP_CONSULTA_PROTOCOLO_PROD,
    SOAP_ACTION_CONSULTA_PROTOCOLO,
    urlConsultaProtocoloNFe,
    cUfDaChave,
};
