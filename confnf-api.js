const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseDecimal(value, fallback = 0) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function validarDigitoVerificador(chave) {
  if (!/^\d{44}$/.test(chave)) return false;
  const numeros = chave.slice(0, -1);
  const dvInformado = parseInt(chave.slice(-1), 10);
  let soma = 0;
  let peso = 2;
  for (let i = numeros.length - 1; i >= 0; i -= 1) {
    soma += parseInt(numeros[i], 10) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dvCalculado = resto < 2 ? 0 : 11 - resto;
  return dvCalculado === dvInformado;
}

function extrairPreviewChave(chave) {
  if (!/^\d{44}$/.test(chave)) return null;
  const mapaUF = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
    '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
    '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
  };
  const ano = `20${chave.slice(2, 4)}`;
  const mes = chave.slice(4, 6);
  return {
    ufCodigo: chave.slice(0, 2),
    uf: mapaUF[chave.slice(0, 2)] || chave.slice(0, 2),
    ano,
    mes,
    cnpjEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: String(parseInt(chave.slice(22, 25), 10)),
    numero: String(parseInt(chave.slice(25, 34), 10)),
    ambiente: chave.slice(34, 35) === '1' ? 'Produção' : 'Homologação'
  };
}

function criarParser(xml2js) {
  return new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    ignoreAttrs: false,
    trim: true,
    explicitRoot: false
  });
}

function extrairInfNfe(resultado) {
  if (resultado.nfeProc?.NFe?.infNFe) return resultado.nfeProc.NFe.infNFe;
  if (resultado.NFe?.infNFe) return resultado.NFe.infNFe;
  if (resultado.nfeProc?.infNFe) return resultado.nfeProc.infNFe;
  if (resultado.infNFe) return resultado.infNFe;
  if (resultado.nfeProc?.nfe?.infNFe) return resultado.nfeProc.nfe.infNFe;
  if (resultado.nfe?.infNFe) return resultado.nfe.infNFe;
  return {};
}

function extrairProt(resultado) {
  return resultado.nfeProc?.protNFe?.infProt
    || resultado.protNFe?.infProt
    || resultado.nfeProc?.protNFe
    || {};
}

function calcularQtEstoque(qtConferida, embalagem) {
  const qt = parseDecimal(qtConferida, 0);
  if (!embalagem) return qt;
  const tipo = String(embalagem.tipo_conversao || 'nenhum').toLowerCase();
  if (tipo === 'fixo') {
    return qt * parseDecimal(embalagem.fator_conversao, 1);
  }
  if (tipo === 'peso') {
    const pesoMedio = parseDecimal(embalagem.peso_medio_un, 0);
    if (pesoMedio <= 0) return 0;
    return Math.floor(qt / pesoMedio);
  }
  return qt;
}

function tpNfPermitidoParaRecebimento(tpNF) {
  const tipo = String(tpNF || '').trim();
  return !tipo || tipo === '0' || tipo === '1';
}

function valoresQuaseIguais(a, b, tolerancia = 0.0001) {
  return Math.abs(parseDecimal(a, 0) - parseDecimal(b, 0)) <= tolerancia;
}

function calcularQuantidadeXmlParaComparacao(qtInformadaErp, item) {
  const qt = parseDecimal(qtInformadaErp, 0);
  const tipo = String(item?.erp_tipo_conversao || item?.tipo_conversao || 'nenhum').toLowerCase();
  const unidadeXml = normalizeText(item?.uCom).toUpperCase();
  const unidadeErp = normalizeText(item?.erp_unidade || item?.unid_erp || item?.uCom).toUpperCase();

  if (!qt) return 0;
  if (!unidadeXml || unidadeXml === unidadeErp || tipo === 'nenhum') return qt;

  if (tipo === 'fixo') {
    const fator = parseDecimal(item?.erp_fator_conversao ?? item?.fator_aplicado, 0);
    return fator > 0 ? qt / fator : qt;
  }

  if (tipo === 'peso') {
    const pesoMedio = parseDecimal(item?.erp_peso_medio_un, 0);
    return pesoMedio > 0 ? qt * pesoMedio : qt;
  }

  return qt;
}

function statusComparativo(item) {
  const qNF = parseDecimal(item.qNF, 0);
  const qtConferida = parseDecimal(item.qt_conferida_xml ?? item.qt_conferida, 0);
  if (item.status === 'extra') return 'EXTRA';
  if (item.status === 'recontagem') return 'RECONTAGEM';
  if (item.status === 'devolvido') return 'DEVOLVIDO';
  if (qtConferida === qNF) return 'OK';
  if (qtConferida < qNF) return 'FALTA';
  if (qtConferida > qNF) return 'SOBRA';
  return 'PENDENTE';
}

async function buscarXmlNfe(getPool, chave) {
  const tentativas = [
    {
      sql: `SELECT * FROM nfe_xml WHERE CHAVE = ? LIMIT 1`,
      params: [chave]
    },
    {
      sql: `SELECT * FROM nfe_xml WHERE CHAVE_NFE = ? LIMIT 1`,
      params: [chave]
    }
  ];

  let ultimoErro = null;
  for (const tentativa of tentativas) {
    try {
      const [rows] = await getPool().query(tentativa.sql, tentativa.params);
      if (rows && rows[0]) {
        const row = rows[0];
        const xmlData = row.XML || row.xml || row.XML_NFE || row.xml_nfe;
        if (xmlData) {
          return {
            xml_data: xmlData,
            chave_nfe: row.CHAVE || row.chave || row.CHAVE_NFE || row.chave_nfe || chave,
            dt_autorizacao: row.DTAUTORIZACAO || row.dt_autorizacao || row.DHRECIBO || row.dhrecibo || null,
            n_protocolo: row.NPROTOCOLO || row.n_protocolo || row.PROTOCOLO_MANIFESTO || row.protocolo_manifesto || null,
            status_nfe: row.STATUS || row.status || row.STATUS_NFE || row.status_nfe || null
          };
        }
      }
    } catch (error) {
      ultimoErro = error;
      if (!['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE', 'ER_PARSE_ERROR'].includes(error.code)) {
        throw error;
      }
    }
  }

  if (ultimoErro && !['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE', 'ER_PARSE_ERROR'].includes(ultimoErro.code)) {
    throw ultimoErro;
  }
  return null;
}

function montarHeaderNfe(infNFe, prot) {
  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const dest = infNFe.dest || {};
  const transp = infNFe.transp || {};
  const volume = toArray(transp.vol)[0] || {};
  const total = infNFe.total?.ICMSTot || infNFe.total || {};
  return {
    chave_nfe: infNFe.Id ? String(infNFe.Id).replace(/^NFe/, '') : '',
    nNF: ide.nNF || '',
    serie: ide.serie || '',
    dhEmi: ide.dhEmi || ide.dEmi || '',
    emitente: {
      cnpj: normalizeDigits(emit.CNPJ || emit.CPF || ''),
      nome: emit.xNome || ''
    },
    destinatario: {
      cnpj: normalizeDigits(dest.CNPJ || dest.CPF || ''),
      nome: dest.xNome || ''
    },
    volumes: parseInt(volume.qVol || 0, 10) || 0,
    pesoB: parseDecimal(volume.pesoB, 0),
    valorNF: parseDecimal(total.vNF, 0),
    tpNF: String(ide.tpNF || ''),
    cStat: String(prot.cStat || ''),
    xMotivo: prot.xMotivo || '',
    protocolo: prot.nProt || ''
  };
}

function montarItensNfe(infNFe) {
  const det = toArray(infNFe.det);
  return det.map((item, index) => {
    const prod = item.prod || {};
    const imposto = item.imposto || {};
    const icmsRoot = Array.isArray(imposto.ICMS) ? imposto.ICMS[0] : (imposto.ICMS || {});
    let icms = {};
    const icmsTipos = [
      'ICMS00', 'ICMS10', 'ICMS20', 'ICMS30', 'ICMS40', 'ICMS41', 'ICMS50', 'ICMS51',
      'ICMS60', 'ICMS70', 'ICMS90', 'ICMS102', 'ICMS500', 'ICMSPart', 'ICMSST',
      'ICMSSN101', 'ICMSSN102', 'ICMSSN103', 'ICMSSN201', 'ICMSSN202', 'ICMSSN203',
      'ICMSSN300', 'ICMSSN400', 'ICMSSN500', 'ICMSSN900'
    ];
    for (const tipo of icmsTipos) {
      if (icmsRoot[tipo]) {
        icms = Array.isArray(icmsRoot[tipo]) ? icmsRoot[tipo][0] : icmsRoot[tipo];
        break;
      }
    }
    const nItem = item.nItem || index + 1;
    return {
      nItem: parseInt(nItem, 10) || index + 1,
      cProd: prod.cProd || '',
      cEAN: prod.cEAN || '',
      cEANTrib: prod.cEANTrib || '',
      xProd: prod.xProd || '',
      NCM: prod.NCM || '',
      CFOP: prod.CFOP || '',
      CST_ICMS: icms.CST || icms.CSOSN || '',
      uCom: prod.uCom || prod.uTrib || 'UN',
      qNF: parseDecimal(prod.qCom || prod.qTrib, 0),
      vUnCom: parseDecimal(prod.vUnCom || prod.vUnTrib, 0),
      vProd: parseDecimal(prod.vProd, 0)
    };
  });
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeBarcode(value) {
  const barcode = normalizeText(value);
  if (!barcode) return '';
  const upper = barcode.toUpperCase();
  if (upper === 'SEM GTIN' || upper === 'SEM_GTIN') return '';
  return barcode;
}

function barcodeCandidates(item) {
  const values = [
    normalizeBarcode(item.cEAN),
    normalizeBarcode(item.cEANTrib)
  ].filter(Boolean);
  const extra = values
    .filter((code) => code.length === 14 && code.startsWith('1'))
    .map((code) => code.slice(1));
  return [...new Set([...values, ...extra])];
}

function montarCodigosLeitura(item) {
  const values = [
    normalizeBarcode(item.cEAN),
    normalizeBarcode(item.cEANTrib),
    normalizeBarcode(item.erp_ean_fornecedor),
    normalizeBarcode(item.erp_ean_unitario),
    normalizeBarcode(item.erp_barra1),
    normalizeBarcode(item.erp_barra2),
    normalizeBarcode(item.erp_barra3),
    normalizeText(item.erp_plu)
  ].filter(Boolean);
  return [...new Set(values)];
}

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  return text.includes('T') ? text.slice(0, 10) : text;
}

async function buscarConversaoProdutoEmbalagem(getPool, tabela, emitenteCnpj, item, erpCodigo = null) {
  const sql = `
    SELECT
      pe.*,
      p.codigo AS erp_codigo,
      COALESCE(p.DESCRICAO, p.descricao, pe.descricao_forn, '') AS erp_descricao,
      COALESCE(pe.unid_erp, '') AS erp_unidade_cadastro
    FROM ${tabela('produto_embalagem')} pe
    LEFT JOIN produto p ON p.codigo = pe.id_produto_erp
    WHERE cnpj_fornecedor = ?
      AND (
        pe.id_produto_erp = ?
        OR pe.cProd_fornecedor = ?
        OR pe.cEAN_fornecedor = ?
        OR pe.cEAN_fornecedor = ?
        OR pe.cEAN_unitario = ?
      )
      AND pe.ativo = 1
    LIMIT 1
  `;
  const [rows] = await getPool().query(sql, [
    emitenteCnpj,
    erpCodigo,
    item.cProd,
    item.cEAN,
    item.cEANTrib,
    item.cEANTrib
  ]);
  return rows && rows[0] ? rows[0] : null;
}

function montarDescricaoSac(row) {
  return normalizeText(row?.descricao_sac || row?.erp_descricao || row?.DESCRICAO || row?.descricao || '');
}

function inferirConversaoPorTabfor(item, vinculoSac) {
  if (!vinculoSac || String(vinculoSac._origem || '') !== 'tabfor') return null;
  const xmlUnidade = normalizeText(item.uCom).toUpperCase();
  const undfor = normalizeText(vinculoSac.tabfor_undfor).toUpperCase();
  const embfor = normalizeText(vinculoSac.tabfor_embfor).toUpperCase();
  const erpUnidade = normalizeText(vinculoSac.erp_unidade).toUpperCase();
  const fatorfor = parseDecimal(vinculoSac.tabfor_fatorfor, 0);

  // Casos como carne bovina: XML em KG e ERP permanece em KG.
  if (xmlUnidade === 'KG' && (erpUnidade === 'KG' || embfor === 'KG') && fatorfor <= 1) {
    return {
      erp_unidade: vinculoSac.erp_unidade || item.uCom,
      erp_tipo_conversao: 'nenhum',
      erp_fator_conversao: 1,
      erp_peso_medio_un: null,
      erp_conversao_origem: 'tabfor'
    };
  }

  // Quando o XML vem em KG e a tabfor informa quantos itens existem por KG.
  if (xmlUnidade === 'KG' && fatorfor > 0 && erpUnidade && erpUnidade !== 'KG') {
    return {
      erp_unidade: vinculoSac.erp_unidade,
      erp_tipo_conversao: 'fixo',
      erp_fator_conversao: fatorfor,
      erp_peso_medio_un: fatorfor > 0 ? 1 / fatorfor : null,
      erp_conversao_origem: 'tabfor'
    };
  }

  // Apoio quando a unidade do XML bate com UNDFOR, mas o ERP usa outra unidade.
  if (undfor && xmlUnidade === undfor && fatorfor > 0 && erpUnidade && erpUnidade !== xmlUnidade) {
    return {
      erp_unidade: vinculoSac.erp_unidade,
      erp_tipo_conversao: 'fixo',
      erp_fator_conversao: fatorfor,
      erp_peso_medio_un: null,
      erp_conversao_origem: 'tabfor'
    };
  }

  return null;
}

function anexarDadosErpNoItem(item, vinculoSac, conversao) {
  const conversaoTabfor = inferirConversaoPorTabfor(item, vinculoSac);
  const conversaoEfetiva = conversao || conversaoTabfor;
  return {
    ...item,
    erp_encontrado: !!(vinculoSac || conversao),
    erp_origem: vinculoSac?._origem || (conversao ? 'produto_embalagem' : null),
    erp_codigo: vinculoSac?.erp_codigo ?? conversao?.erp_codigo ?? conversao?.id_produto_erp ?? null,
    erp_descricao: montarDescricaoSac(vinculoSac) || conversao?.erp_descricao || conversao?.descricao_forn || null,
    erp_unidade: conversaoEfetiva?.erp_unidade || conversao?.unid_erp || vinculoSac?.erp_unidade || conversao?.erp_unidade_cadastro || item.uCom || null,
    erp_tipo_conversao: conversaoEfetiva?.erp_tipo_conversao || conversao?.tipo_conversao || 'nenhum',
    erp_fator_conversao: conversaoEfetiva?.erp_fator_conversao != null
      ? parseDecimal(conversaoEfetiva.erp_fator_conversao, 1)
      : (conversao?.fator_conversao == null ? 1 : parseDecimal(conversao.fator_conversao, 1)),
    erp_peso_medio_un: conversaoEfetiva?.erp_peso_medio_un != null
      ? parseDecimal(conversaoEfetiva.erp_peso_medio_un, 4)
      : (conversao?.peso_medio_un == null ? null : parseDecimal(conversao.peso_medio_un, 4)),
    erp_ean_fornecedor: conversao?.cEAN_fornecedor || vinculoSac?.embalagem_barra1 || vinculoSac?.embalagem_barra2 || vinculoSac?.embalagem_barra3 || null,
    erp_ean_unitario: conversao?.cEAN_unitario || null,
    erp_barra1: vinculoSac?.embalagem_barra1 || null,
    erp_barra2: vinculoSac?.embalagem_barra2 || null,
    erp_barra3: vinculoSac?.embalagem_barra3 || null,
    erp_plu: vinculoSac?.embalagem_plu_digito || vinculoSac?.embalagem_plu || null,
    erp_embfor: vinculoSac?.tabfor_embfor || null,
    erp_undfor: vinculoSac?.tabfor_undfor || null,
    erp_fatorfor: vinculoSac?.tabfor_fatorfor == null ? null : parseDecimal(vinculoSac.tabfor_fatorfor, 4),
    erp_conversao_origem: conversao ? 'produto_embalagem' : (conversaoTabfor?.erp_conversao_origem || null)
  };
}

async function buscarVinculosSacNfNaoLancada(getPool, emitenteCnpj, destinatarioCnpj, itens) {
  if (!emitenteCnpj || !Array.isArray(itens) || itens.length === 0) return {};

  const pool = getPool();
  const resultado = {};
  const codigos = [...new Set(itens.flatMap((item) => {
    const code = normalizeText(item.cProd);
    if (!code) return [];
    const semZeros = code.replace(/^0+/, '') || '0';
    return semZeros === code ? [code] : [code, semZeros];
  }))];

  if (codigos.length > 0) {
    const placeholders = codigos.map(() => '?').join(', ');
    const sqlTabfor = `
      SELECT
        tabfor.CODFOR,
        tabfor.NSU,
        tabfor.FATORFOR AS tabfor_fatorfor,
        tabfor.EMBFOR AS tabfor_embfor,
        tabfor.UNDFOR AS tabfor_undfor,
        produto.codigo AS erp_codigo,
        TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) AS descricao_sac,
        COALESCE(embalagem.UNIDADE, embalagem.Unidade, '') AS erp_unidade,
        embalagem.BARRA1 AS embalagem_barra1,
        embalagem.BARRA2 AS embalagem_barra2,
        embalagem.BARRA3 AS embalagem_barra3,
        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) AS embalagem_plu,
        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) AS embalagem_plu_digito
      FROM sac.tabfor
      LEFT JOIN sac.embalagem ON embalagem.CODPRODUTO = tabfor.NSU
      LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
      LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
      LEFT JOIN sac.fornece ON fornece.CNPJ = ?
      LEFT JOIN sac.estab ON estab.CNPJ = ?
      WHERE tabfor.FORNECE = ? AND tabfor.CODFOR IN (${placeholders})
    `;
    const [rows] = await pool.query(sqlTabfor, [emitenteCnpj, destinatarioCnpj || '', emitenteCnpj, ...codigos]);
    (rows || []).forEach((row) => {
      const codfor = normalizeText(row.CODFOR);
      if (!codfor) return;
      row._origem = 'tabfor';
      resultado[codfor] = resultado[codfor] || row;
      const semZeros = codfor.replace(/^0+/, '') || '0';
      resultado[semZeros] = resultado[semZeros] || row;
    });
  }

  const itensSemMatch = itens.filter((item) => {
    const code = normalizeText(item.cProd);
    const semZeros = code.replace(/^0+/, '') || '0';
    return !(resultado[code] || resultado[semZeros]);
  });
  const barras = [...new Set(itensSemMatch.flatMap((item) => barcodeCandidates(item)))];
  if (barras.length > 0) {
    const placeholders = barras.map(() => '?').join(', ');
    const sqlEmbalagem = `
      SELECT
        embalagem.CODPRODUTO AS NSU,
        produto.codigo AS erp_codigo,
        TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) AS descricao_sac,
        COALESCE(embalagem.UNIDADE, embalagem.Unidade, '') AS erp_unidade,
        embalagem.BARRA1 AS embalagem_barra1,
        embalagem.BARRA2 AS embalagem_barra2,
        embalagem.BARRA3 AS embalagem_barra3,
        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) AS embalagem_plu,
        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) AS embalagem_plu_digito
      FROM sac.embalagem
      LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
      LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
      LEFT JOIN sac.fornece ON fornece.CNPJ = ?
      LEFT JOIN sac.estab ON estab.CNPJ = ?
      WHERE embalagem.BARRA1 IN (${placeholders})
         OR embalagem.BARRA2 IN (${placeholders})
         OR embalagem.BARRA3 IN (${placeholders})
      LIMIT 500
    `;
    const [rows] = await pool.query(sqlEmbalagem, [emitenteCnpj, destinatarioCnpj || '', ...barras, ...barras, ...barras]);
    (rows || []).forEach((row) => {
      row._origem = 'embalagem';
      [row.embalagem_barra1, row.embalagem_barra2, row.embalagem_barra3]
        .map((code) => normalizeBarcode(code))
        .filter(Boolean)
        .forEach((code) => {
          resultado[code] = resultado[code] || row;
          if (code.length === 14 && code.startsWith('1')) {
            const semPrefixo = code.slice(1);
            resultado[semPrefixo] = resultado[semPrefixo] || row;
          }
        });
    });
  }

  return resultado;
}

async function enriquecerItensComErp(getPool, tabela, contexto, itens) {
  const emitenteCnpj = normalizeDigits(contexto?.emitenteCnpj || '');
  const destinatarioCnpj = normalizeDigits(contexto?.destinatarioCnpj || '');
  if (!emitenteCnpj || !Array.isArray(itens) || itens.length === 0) {
    return Array.isArray(itens) ? itens : [];
  }
  const vinculosSac = await buscarVinculosSacNfNaoLancada(getPool, emitenteCnpj, destinatarioCnpj, itens).catch(() => ({}));
  const enriquecidos = await Promise.all(
    itens.map(async (item) => {
      const codigo = normalizeText(item.cProd);
      const semZeros = codigo.replace(/^0+/, '') || '0';
      const vinculoSac = vinculosSac[codigo]
        || vinculosSac[semZeros]
        || barcodeCandidates(item).map((code) => vinculosSac[code]).find(Boolean)
        || null;
      const conversao = await buscarConversaoProdutoEmbalagem(
        getPool,
        tabela,
        emitenteCnpj,
        item,
        vinculoSac?.erp_codigo || null
      ).catch(() => null);
      return anexarDadosErpNoItem(item, vinculoSac, conversao);
    })
  );
  return enriquecidos;
}

function filtrarItensParaConferente(itens) {
  return itens.map((item) => ({
    nItem: item.nItem,
    cProd: item.cProd,
    cEAN: item.cEAN,
    cEANTrib: item.cEANTrib,
    xProd: item.xProd,
    uCom: item.uCom,
    unid_erp: item.unid_erp || item.uCom || 'UN',
    fator_aplicado: item.fator_aplicado == null ? 1 : parseDecimal(item.fator_aplicado, 1),
    tipo_conversao: item.tipo_conversao || 'nenhum',
    erp_encontrado: !!item.erp_encontrado,
    erp_codigo: item.erp_codigo ?? null,
    erp_descricao: item.erp_descricao ?? null,
    erp_unidade: item.erp_unidade || item.unid_erp || item.uCom || 'UN',
    erp_tipo_conversao: item.erp_tipo_conversao || item.tipo_conversao || 'nenhum',
    erp_fator_conversao: item.erp_fator_conversao == null ? (item.fator_aplicado == null ? 1 : parseDecimal(item.fator_aplicado, 1)) : parseDecimal(item.erp_fator_conversao, 1),
    erp_peso_medio_un: item.erp_peso_medio_un == null ? null : parseDecimal(item.erp_peso_medio_un, 4),
    erp_ean_fornecedor: item.erp_ean_fornecedor ?? null,
    erp_ean_unitario: item.erp_ean_unitario ?? null,
    erp_barra1: item.erp_barra1 ?? null,
    erp_barra2: item.erp_barra2 ?? null,
    erp_barra3: item.erp_barra3 ?? null,
    erp_embfor: item.erp_embfor ?? null,
    erp_undfor: item.erp_undfor ?? null,
    erp_fatorfor: item.erp_fatorfor == null ? null : parseDecimal(item.erp_fatorfor, 4),
    erp_conversao_origem: item.erp_conversao_origem ?? null,
    scan_codes: montarCodigosLeitura(item),
    lotes: Array.isArray(item.lotes) ? item.lotes : [],
    qt_conferida_xml: item.qt_conferida == null ? null : parseDecimal(calcularQuantidadeXmlParaComparacao(item.qt_conferida, item), 4),
    unidade_digitacao: item.erp_unidade || item.unid_erp || item.uCom || 'UN',
    qt_conferida: item.qt_conferida == null ? null : parseDecimal(item.qt_conferida, 0),
    status: item.status || 'pendente',
    dt_conferencia: item.dt_conferencia || null,
    obs: item.obs || ''
  }));
}

function montarItensSupervisor(itens) {
  return itens.map((item) => {
    const qNF = parseDecimal(item.qNF, 0);
    const qtConferidaErp = parseDecimal(item.qt_conferida, 0);
    const qtConferidaXml = parseDecimal(calcularQuantidadeXmlParaComparacao(qtConferidaErp, item), 4);
    const diferenca = qtConferidaXml - qNF;
    const percentual = qNF > 0 ? (diferenca / qNF) * 100 : 0;
    return {
      ...item,
      qNF,
      qt_conferida: qtConferidaErp,
      qt_conferida_erp: qtConferidaErp,
      qt_conferida_xml: qtConferidaXml,
      diferenca,
      percentual_diferenca: percentual,
      unidade_digitacao: item.erp_unidade || item.unid_erp || item.uCom || 'UN',
      scan_codes: montarCodigosLeitura(item),
      lotes: Array.isArray(item.lotes) ? item.lotes : [],
      status_resumido: statusComparativo(item)
    };
  });
}

module.exports = function registerConfNfRoutes(app, options) {
  const {
    getPool,
    xml2js,
    confDbName = process.env.CONFNF_DB_NAME || 'confnf',
    jwtSecret = process.env.CONFNF_JWT_SECRET || 'confnf-dev-secret',
    sessionHours = Number(process.env.CONFNF_SESSION_HOURS) || 8
  } = options;

  const tabela = (name) => `\`${confDbName}\`.\`${name}\``;

  async function garantirSchemaConfnfComplementar() {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${tabela('conf_item_lote')} (
        id INT NOT NULL AUTO_INCREMENT,
        id_item INT NOT NULL,
        lote VARCHAR(60) DEFAULT NULL,
        dt_validade DATE DEFAULT NULL,
        qt_informada DECIMAL(12,4) DEFAULT NULL,
        unidade VARCHAR(6) DEFAULT NULL,
        obs TEXT,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_conf_item_lote_item (id_item),
        CONSTRAINT fk_conf_item_lote_item FOREIGN KEY (id_item) REFERENCES ${tabela('conf_itens')} (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;
    await getPool().query(sql);
  }

  async function carregarConferenciaPorChave(chave) {
    const sql = `
      SELECT *
      FROM ${tabela('conf_cabecalho')}
      WHERE chave_nfe = ?
      ORDER BY id DESC
      LIMIT 1
    `;
    const [rows] = await getPool().query(sql, [chave]);
    return rows && rows[0] ? rows[0] : null;
  }

  async function carregarConferenciasPorChave(chave) {
    const sql = `
      SELECT *
      FROM ${tabela('conf_cabecalho')}
      WHERE chave_nfe = ?
      ORDER BY id DESC
    `;
    const [rows] = await getPool().query(sql, [chave]);
    return rows || [];
  }

  function selecionarConferenciaAtiva(conferencias) {
    const lista = Array.isArray(conferencias) ? conferencias : [];
    const aguardando = lista.find((item) => item.status === 'aguard_aprovacao');
    if (aguardando) return aguardando;
    const emAndamento = lista.find((item) => ['aberta', 'recontagem'].includes(item.status));
    if (emAndamento) return emAndamento;
    return lista[0] || null;
  }

  async function carregarConferenciaPorId(id) {
    const sql = `SELECT * FROM ${tabela('conf_cabecalho')} WHERE id = ? LIMIT 1`;
    const [rows] = await getPool().query(sql, [id]);
    return rows && rows[0] ? rows[0] : null;
  }

  async function carregarItensConferencia(idCabecalho) {
    const sql = `
      SELECT *
      FROM ${tabela('conf_itens')}
      WHERE id_cabecalho = ?
      ORDER BY nItem ASC, id ASC
    `;
    const [rows] = await getPool().query(sql, [idCabecalho]);
    return rows || [];
  }

  async function carregarExtrasConferencia(idCabecalho) {
    const sql = `
      SELECT *
      FROM ${tabela('conf_extra')}
      WHERE id_cabecalho = ?
      ORDER BY id ASC
    `;
    const [rows] = await getPool().query(sql, [idCabecalho]);
    return rows || [];
  }

  async function carregarLotesPorItemIds(itemIds) {
    const ids = Array.isArray(itemIds) ? itemIds.filter((id) => Number.isFinite(Number(id))) : [];
    if (ids.length === 0) return {};
    const placeholders = ids.map(() => '?').join(', ');
    const sql = `
      SELECT id, id_item, lote, dt_validade, qt_informada, unidade, obs
      FROM ${tabela('conf_item_lote')}
      WHERE id_item IN (${placeholders})
      ORDER BY id ASC
    `;
    const [rows] = await getPool().query(sql, ids);
    const mapa = {};
    (rows || []).forEach((row) => {
      const key = String(row.id_item);
      if (!mapa[key]) mapa[key] = [];
      mapa[key].push({
        id: row.id,
        lote: row.lote || '',
        dt_validade: formatDateOnly(row.dt_validade),
        qt_informada: parseDecimal(row.qt_informada, 0),
        unidade: row.unidade || null,
        obs: row.obs || ''
      });
    });
    return mapa;
  }

  async function authConfnf(req, res, next) {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token) {
        return res.status(401).json({ error: 'Token de acesso não informado.' });
      }
      const payload = jwt.verify(token, jwtSecret);
      req.user = payload;
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
  }

  garantirSchemaConfnfComplementar().catch((error) => {
    console.error('Erro ao garantir schema complementar do ConfNF:', error);
  });

  app.post('/api/confnf/login', async (req, res) => {
    const { usuario, senha, pin } = req.body || {};
    if (!usuario || (!senha && !pin)) {
      return res.status(400).json({ error: 'Informe usuário e senha ou PIN.' });
    }

    try {
      const sql = `
        SELECT id, usuario, nome, senha_hash, pin_hash, perfil, ativo
        FROM ${tabela('conf_usuario')}
        WHERE usuario = ?
        LIMIT 1
      `;
      const [rows] = await getPool().query(sql, [usuario]);
      const user = rows && rows[0] ? rows[0] : null;
      if (!user || !user.ativo) {
        return res.status(401).json({ error: 'Usuário inválido ou inativo.' });
      }

      const senhaOk = senha ? hashValue(senha) === String(user.senha_hash || '').toLowerCase() : false;
      const pinOk = pin ? hashValue(pin) === String(user.pin_hash || '').toLowerCase() : false;
      if (!senhaOk && !pinOk) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const token = jwt.sign(
        {
          sub: user.id,
          usuario: user.usuario,
          nome: user.nome,
          perfil: user.perfil
        },
        jwtSecret,
        { expiresIn: `${sessionHours}h` }
      );

      await getPool().query(
        `UPDATE ${tabela('conf_usuario')} SET ultimo_login = NOW(), atualizado_em = NOW() WHERE id = ?`,
        [user.id]
      );

      return res.json({
        token,
        expires_in_hours: sessionHours,
        usuario: {
          id: user.id,
          usuario: user.usuario,
          nome: user.nome,
          perfil: user.perfil
        }
      });
    } catch (error) {
      console.error('Erro no login ConfNF:', error);
      return res.status(500).json({ error: 'Falha ao autenticar no ConfNF.' });
    }
  });

  app.get('/api/confnf/nfe/xml', authConfnf, async (req, res) => {
    const chave = String(req.query.chave || '').trim();
    if (!/^\d{44}$/.test(chave) || !validarDigitoVerificador(chave)) {
      return res.status(400).json({ error: 'Chave NF-e inválida.' });
    }
    if (!xml2js) {
      return res.status(503).json({ error: 'xml2js não está disponível no servidor.' });
    }

    try {
      const xmlRow = await buscarXmlNfe(getPool, chave);
      if (!xmlRow) {
        return res.status(404).json({ error: 'NF-e não encontrada em SAC.NFE_XML.' });
      }

      const parser = criarParser(xml2js);
      const parsed = await parser.parseStringPromise(xmlRow.xml_data);
      const infNFe = extrairInfNfe(parsed);
      const prot = extrairProt(parsed);
      const header = montarHeaderNfe(infNFe, prot);
      const itens = await enriquecerItensComErp(getPool, tabela, {
        emitenteCnpj: header.emitente.cnpj,
        destinatarioCnpj: header.destinatario.cnpj
      }, montarItensNfe(infNFe));

      if (String(header.cStat || '') && String(header.cStat) !== '100') {
        return res.status(400).json({ error: `NF-e não autorizada para conferência. cStat: ${header.cStat}.` });
      }
      if (!tpNfPermitidoParaRecebimento(header.tpNF)) {
        return res.status(400).json({ error: `tpNF inválido para conferência de recebimento: ${header.tpNF}.` });
      }

      const conferencia = selecionarConferenciaAtiva(await carregarConferenciasPorChave(chave));
      const perfil = String(req.user.perfil || '').toLowerCase();
      return res.json({
        chave_preview: extrairPreviewChave(chave),
        nfe: {
          ...header,
          itens: perfil === 'conferente'
            ? filtrarItensParaConferente(itens)
            : montarItensSupervisor(itens)
        },
        conferencia: conferencia ? {
          id: conferencia.id,
          status: conferencia.status,
          id_conferente: conferencia.id_conferente,
          dt_inicio: conferencia.dt_inicio,
          dt_fim: conferencia.dt_fim
        } : null
      });
    } catch (error) {
      console.error('Erro ao buscar XML ConfNF:', error);
      return res.status(500).json({ error: 'Falha ao consultar XML da NF-e.' });
    }
  });

  app.post('/api/confnf/conferencia/iniciar', authConfnf, async (req, res) => {
    const { chave_nfe, doca } = req.body || {};
    const chave = String(chave_nfe || '').trim();
    if (!/^\d{44}$/.test(chave) || !validarDigitoVerificador(chave)) {
      return res.status(400).json({ error: 'Chave NF-e inválida.' });
    }
    if (!xml2js) {
      return res.status(503).json({ error: 'xml2js não está disponível no servidor.' });
    }

    try {
      const conferenciasExistentes = await carregarConferenciasPorChave(chave);
      const existente = selecionarConferenciaAtiva(conferenciasExistentes);
      if (existente && existente.status === 'aprovada') {
        return res.status(409).json({ error: 'Esta NF-e já foi aprovada.', conferencia: existente });
      }
      if (existente && ['aberta', 'aguard_aprovacao'].includes(existente.status) && String(existente.id_conferente) !== String(req.user.sub)) {
        return res.status(409).json({ error: 'Já existe conferência em andamento para esta chave por outro conferente.', conferencia: existente });
      }
      if (existente && ['aberta', 'recontagem', 'aguard_aprovacao'].includes(existente.status) && String(existente.id_conferente) === String(req.user.sub)) {
        return res.json({ id_conferencia: existente.id, status: existente.status, retomada: true });
      }

      const xmlRow = await buscarXmlNfe(getPool, chave);
      if (!xmlRow) {
        return res.status(404).json({ error: 'NF-e não encontrada em SAC.NFE_XML.' });
      }

      const parser = criarParser(xml2js);
      const parsed = await parser.parseStringPromise(xmlRow.xml_data);
      const infNFe = extrairInfNfe(parsed);
      const prot = extrairProt(parsed);
      const header = montarHeaderNfe(infNFe, prot);
      const itens = await enriquecerItensComErp(getPool, tabela, {
        emitenteCnpj: header.emitente.cnpj,
        destinatarioCnpj: header.destinatario.cnpj
      }, montarItensNfe(infNFe));

      if (String(header.cStat || '') && String(header.cStat) !== '100') {
        return res.status(400).json({ error: `NF-e não autorizada para conferência. cStat: ${header.cStat}.` });
      }
      if (!tpNfPermitidoParaRecebimento(header.tpNF)) {
        return res.status(400).json({ error: `tpNF inválido para conferência de recebimento: ${header.tpNF}.` });
      }

      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();
        const insertCab = `
          INSERT INTO ${tabela('conf_cabecalho')} (
            chave_nfe, nNF, serie, cnpj_emitente, nome_emitente, cnpj_destinatario, nome_destinatario,
            dhEmi, vNF, qVol, pesoB, id_conferente, doca, dt_inicio, status, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'aberta', NOW(), NOW())
        `;
        const [cabResult] = await connection.query(insertCab, [
          chave,
          header.nNF,
          header.serie,
          header.emitente.cnpj,
          header.emitente.nome,
          header.destinatario.cnpj,
          header.destinatario.nome,
          header.dhEmi ? new Date(header.dhEmi) : null,
          header.valorNF,
          header.volumes,
          header.pesoB,
          req.user.sub,
          doca || null
        ]);
        const idCabecalho = cabResult.insertId;

        for (const item of itens) {
          await connection.query(
            `INSERT INTO ${tabela('conf_itens')} (
              id_cabecalho, nItem, cProd, cEAN, cEANTrib, xProd, NCM, CFOP, CST_ICMS,
              uCom, qNF, vUnCom, vProd, qt_conferida, qt_estoque_erp, unid_erp, fator_aplicado,
              status, obs, criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'pendente', ?, NOW(), NOW())`,
            [
              idCabecalho,
              item.nItem,
              item.cProd,
              item.cEAN,
              item.cEANTrib,
              item.xProd,
              item.NCM,
              item.CFOP,
              item.CST_ICMS,
              item.uCom,
              item.qNF,
              item.vUnCom,
              item.vProd,
              item.erp_unidade || item.uCom || 'UN',
              item.erp_fator_conversao || 1,
              item.erp_encontrado
                ? `Vínculo ERP via ${item.erp_origem || 'SAC'}; conversão ${item.erp_tipo_conversao || 'nenhum'}`
                : 'Sem vínculo ERP; usar conferência na unidade original.'
            ]
          );
        }

        await connection.commit();
        return res.json({ id_conferencia: idCabecalho, status: 'aberta' });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Erro ao iniciar conferência ConfNF:', error);
      return res.status(500).json({ error: 'Falha ao iniciar conferência.' });
    }
  });

  app.post('/api/confnf/conferencia/resultado', authConfnf, async (req, res) => {
    const { id_conferencia, itens, extras, obs } = req.body || {};
    if (!id_conferencia) {
      return res.status(400).json({ error: 'Informe o id_conferencia.' });
    }

    try {
      const cabecalho = await carregarConferenciaPorId(id_conferencia);
      if (!cabecalho) return res.status(404).json({ error: 'Conferência não encontrada.' });
      if (String(cabecalho.id_conferente) !== String(req.user.sub) && !['supervisor', 'administrador'].includes(String(req.user.perfil || ''))) {
        return res.status(403).json({ error: 'Você não pode enviar resultado desta conferência.' });
      }

      const itensArr = Array.isArray(itens) ? itens : [];
      const extrasArr = Array.isArray(extras) ? extras : [];
      const itensOriginaisBase = await carregarItensConferencia(id_conferencia);
      const itensOriginais = await enriquecerItensComErp(getPool, tabela, {
        emitenteCnpj: cabecalho.cnpj_emitente,
        destinatarioCnpj: cabecalho.cnpj_destinatario
      }, itensOriginaisBase);
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();

        for (const payloadItem of itensArr) {
          const itemDb = itensOriginais.find((it) => String(it.nItem) === String(payloadItem.nItem));
          if (!itemDb) continue;
          const qtConferidaErp = parseDecimal(payloadItem.qt_conferida, 0);
          const qtConferidaXml = parseDecimal(calcularQuantidadeXmlParaComparacao(qtConferidaErp, itemDb), 4);
          const qtEstoque = qtConferidaErp;
          const novoStatus = valoresQuaseIguais(qtConferidaXml, itemDb.qNF) ? 'conferido' : 'divergente';
          await connection.query(
            `UPDATE ${tabela('conf_itens')}
             SET qt_conferida = ?, qt_estoque_erp = ?, status = ?, dt_conferencia = NOW(), obs = ?, atualizado_em = NOW()
             WHERE id = ?`,
            [qtConferidaErp, qtEstoque, novoStatus, payloadItem.obs || null, itemDb.id]
          );

          await connection.query(`DELETE FROM ${tabela('conf_item_lote')} WHERE id_item = ?`, [itemDb.id]);
          const lotes = Array.isArray(payloadItem.lotes) ? payloadItem.lotes : [];
          for (const lote of lotes) {
            const qtLote = parseDecimal(lote.qt_informada, 0);
            if (!qtLote && !normalizeText(lote.lote) && !normalizeText(lote.dt_validade)) continue;
            await connection.query(
              `INSERT INTO ${tabela('conf_item_lote')}
               (id_item, lote, dt_validade, qt_informada, unidade, obs, criado_em, atualizado_em)
               VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [
                itemDb.id,
                normalizeText(lote.lote) || null,
                normalizeText(lote.dt_validade) || null,
                qtLote,
                normalizeText(lote.unidade) || itemDb.erp_unidade || itemDb.unid_erp || itemDb.uCom || null,
                normalizeText(lote.obs) || null
              ]
            );
          }
        }

        await connection.query(`DELETE FROM ${tabela('conf_extra')} WHERE id_cabecalho = ?`, [id_conferencia]);
        for (const extra of extrasArr) {
          await connection.query(
            `INSERT INTO ${tabela('conf_extra')} (id_cabecalho, cEAN, xProd, qt_conferida, dt_registro, obs)
             VALUES (?, ?, ?, ?, NOW(), ?)`,
            [id_conferencia, extra.cEAN || null, extra.descricao || 'ITEM EXTRA', parseDecimal(extra.qt_conferida, 0), extra.obs || null]
          );
        }

        await connection.query(
          `UPDATE ${tabela('conf_cabecalho')}
           SET status = 'aguard_aprovacao', obs = ?, dt_fim = NOW(), atualizado_em = NOW()
           WHERE id = ?`,
          [obs || cabecalho.obs || null, id_conferencia]
        );

        await connection.commit();
        return res.json({ success: true, status: 'aguard_aprovacao' });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Erro ao enviar resultado ConfNF:', error);
      if (error && error.code === 'ER_DUP_ENTRY' && String(error.sqlMessage || '').includes('uk_conf_cabecalho_chave_status')) {
        const conferenciaAtual = await carregarConferenciaPorId(id_conferencia).catch(() => null);
        const ativa = conferenciaAtual?.chave_nfe
          ? selecionarConferenciaAtiva(await carregarConferenciasPorChave(conferenciaAtual.chave_nfe))
          : null;
        return res.status(409).json({
          error: 'Já existe outra conferência desta chave aguardando aprovação. Retome a conferência pendente antes de reenviar.',
          conferencia: ativa ? {
            id: ativa.id,
            status: ativa.status,
            id_conferente: ativa.id_conferente
          } : null
        });
      }
      return res.status(500).json({ error: 'Falha ao enviar resultado da conferência.' });
    }
  });

  app.get('/api/confnf/conferencia/:id', authConfnf, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

    try {
      const cabecalho = await carregarConferenciaPorId(id);
      if (!cabecalho) return res.status(404).json({ error: 'Conferência não encontrada.' });
      const perfil = String(req.user.perfil || '').toLowerCase();
      if (perfil === 'conferente' && String(cabecalho.id_conferente) !== String(req.user.sub)) {
        return res.status(403).json({ error: 'Acesso negado a esta conferência.' });
      }

      const itensBase = await carregarItensConferencia(id);
      const itens = await enriquecerItensComErp(getPool, tabela, {
        emitenteCnpj: cabecalho.cnpj_emitente,
        destinatarioCnpj: cabecalho.cnpj_destinatario
      }, itensBase);
      const lotesPorItem = await carregarLotesPorItemIds(itens.map((item) => item.id));
      itens.forEach((item) => {
        item.lotes = lotesPorItem[String(item.id)] || [];
      });
      const extras = await carregarExtrasConferencia(id);
      return res.json({
        cabecalho,
        itens: perfil === 'conferente' ? filtrarItensParaConferente(itens) : montarItensSupervisor(itens),
        extras
      });
    } catch (error) {
      console.error('Erro ao carregar conferência ConfNF:', error);
      return res.status(500).json({ error: 'Falha ao carregar conferência.' });
    }
  });

  app.get('/api/confnf/conferencias/pendentes', authConfnf, async (req, res) => {
    try {
      const perfil = String(req.user.perfil || '').toLowerCase();
      const wherePerfil = perfil === 'conferente' ? 'AND c.id_conferente = ?' : '';
      const params = perfil === 'conferente' ? [req.user.sub] : [];
      const sql = `
        SELECT c.id, c.chave_nfe, c.nNF, c.serie, c.nome_emitente, c.status, c.dt_inicio, u.nome AS conferente
        FROM ${tabela('conf_cabecalho')} c
        LEFT JOIN ${tabela('conf_usuario')} u ON u.id = c.id_conferente
        WHERE c.status IN ('aberta', 'aguard_aprovacao', 'recontagem')
        ${wherePerfil}
        ORDER BY c.id DESC
      `;
      const [rows] = await getPool().query(sql, params);
      return res.json(rows || []);
    } catch (error) {
      console.error('Erro ao listar pendências ConfNF:', error);
      return res.status(500).json({ error: 'Falha ao listar conferências pendentes.' });
    }
  });

  app.post('/api/confnf/conferencia/aprovar', authConfnf, async (req, res) => {
    const perfil = String(req.user.perfil || '').toLowerCase();
    if (!['supervisor', 'administrador'].includes(perfil)) {
      return res.status(403).json({ error: 'Somente supervisor ou administrador podem aprovar conferências.' });
    }

    const { id_conferencia, acoes, acao_global, obs } = req.body || {};
    if (!id_conferencia) return res.status(400).json({ error: 'Informe o id_conferencia.' });

    try {
      const cabecalho = await carregarConferenciaPorId(id_conferencia);
      if (!cabecalho) return res.status(404).json({ error: 'Conferência não encontrada.' });

      const itens = await carregarItensConferencia(id_conferencia);
      const acoesArr = Array.isArray(acoes) ? acoes : [];
      const connection = await getPool().getConnection();
      let novoStatusCabecalho = 'aprovada';
      try {
        await connection.beginTransaction();

        for (const acao of acoesArr) {
          const item = itens.find((it) => String(it.id) === String(acao.id_item) || String(it.nItem) === String(acao.nItem));
          if (!item) continue;
          const tipoAcao = String(acao.acao || '').trim();
          let statusItem = item.status;
          let valorDepois = item.qt_conferida;

          if (tipoAcao === 'aceitar') {
            statusItem = 'conferido';
          } else if (tipoAcao === 'devolver') {
            statusItem = 'devolvido';
          } else if (tipoAcao === 'recontagem') {
            statusItem = 'recontagem';
            novoStatusCabecalho = 'recontagem';
          } else if (tipoAcao === 'forcar_nf') {
            if (!acao.obs) {
              await connection.rollback().catch(() => {});
              return res.status(400).json({ error: `Justificativa obrigatória para forçar aceite da NF no item ${item.nItem}.` });
            }
            statusItem = 'conferido';
            valorDepois = item.qNF;
            await connection.query(
              `UPDATE ${tabela('conf_itens')}
               SET qt_conferida = ?, qt_estoque_erp = ?, status = ?, obs = ?, atualizado_em = NOW()
               WHERE id = ?`,
              [item.qNF, item.qNF, statusItem, acao.obs, item.id]
            );
          } else {
            continue;
          }

          if (tipoAcao !== 'forcar_nf') {
            await connection.query(
              `UPDATE ${tabela('conf_itens')}
               SET status = ?, obs = ?, atualizado_em = NOW()
               WHERE id = ?`,
              [statusItem, acao.obs || item.obs || null, item.id]
            );
          }

          const hashIntegridade = hashValue(`${id_conferencia}|${item.id}|${req.user.sub}|${tipoAcao}|${Date.now()}`);
          await connection.query(
            `INSERT INTO ${tabela('conf_log_supervisor')}
             (id_cabecalho, id_item, id_supervisor, dt_acao, acao, valor_antes, valor_depois, justificativa, hash_integridade)
             VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
            [id_conferencia, item.id, req.user.sub, tipoAcao, parseDecimal(item.qt_conferida, 0), parseDecimal(valorDepois, 0), acao.obs || null, hashIntegridade]
          );
        }

        if (acao_global === 'rejeitar_nf') {
          novoStatusCabecalho = 'recusada';
        } else if (acao_global === 'aprovar_tudo' && novoStatusCabecalho !== 'recontagem') {
          novoStatusCabecalho = 'aprovada';
        }

        await connection.query(
          `UPDATE ${tabela('conf_cabecalho')}
           SET status = ?, id_supervisor = ?, obs = ?, atualizado_em = NOW()
           WHERE id = ?`,
          [novoStatusCabecalho, req.user.sub, obs || cabecalho.obs || null, id_conferencia]
        );

        await connection.commit();
        return res.json({ success: true, status: novoStatusCabecalho });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Erro ao aprovar conferência ConfNF:', error);
      return res.status(500).json({ error: 'Falha ao processar aprovação da conferência.' });
    }
  });
};
