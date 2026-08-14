const CAP_NFS = 500;

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseDecimal(value, fallback = 0) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function padCnpj(value) {
  const digits = normalizeDigits(value);
  if (!digits) return '';
  return digits.padStart(14, '0').slice(-14);
}

function normalizeCodigo(value) {
  const code = normalizeText(value).toUpperCase().replace(/[\s\-./\\_]/g, '');
  if (!code) return '';
  if (/^\d+$/.test(code)) {
    return code.replace(/^0+/, '') || '0';
  }
  return code.replace(/^0+/, '') || code;
}

function variantesCodigo(value) {
  const raw = normalizeText(value);
  if (!raw) return [];
  const set = new Set();
  set.add(raw);
  set.add(raw.toUpperCase());
  set.add(normalizeCodigo(raw));
  const digits = normalizeDigits(raw);
  if (digits) {
    set.add(digits);
    set.add(digits.replace(/^0+/, '') || '0');
  }
  return [...set].filter(Boolean);
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

function extrairItensXml(infNFe) {
  const det = toArray(infNFe?.det);
  return det.map((item, index) => {
    const prod = item.prod || {};
    return {
      nItem: parseInt(item.nItem || index + 1, 10) || index + 1,
      cProd: normalizeText(prod.cProd),
      cEAN: normalizeText(prod.cEAN),
      cEANTrib: normalizeText(prod.cEANTrib),
      xProd: normalizeText(prod.xProd),
      uCom: normalizeText(prod.uCom || prod.uTrib || 'UN').toUpperCase(),
      uTrib: normalizeText(prod.uTrib || prod.uCom || '').toUpperCase(),
      qCom: parseDecimal(prod.qCom, 0),
      qTrib: parseDecimal(prod.qTrib, 0)
    };
  });
}

function montarExpressaoDataLocal(campo = 'n.EMISSAO') {
  return `
    COALESCE(
      STR_TO_DATE(REPLACE(${campo}, 'T', ' '), '%Y-%m-%d %H:%i:%s'),
      STR_TO_DATE(${campo}, '%Y-%m-%d %H:%i:%s'),
      STR_TO_DATE(${campo}, '%Y-%m-%d'),
      STR_TO_DATE(${campo}, '%d/%m/%Y %H:%i:%s'),
      STR_TO_DATE(${campo}, '%d/%m/%Y'),
      STR_TO_DATE(${campo}, '%Y/%m/%d %H:%i:%s'),
      STR_TO_DATE(${campo}, '%Y/%m/%d'),
      STR_TO_DATE(${campo}, '%d-%m-%Y %H:%i:%s'),
      STR_TO_DATE(${campo}, '%d-%m-%Y'),
      STR_TO_DATE(${campo}, '%Y%m%d%H%i%s'),
      STR_TO_DATE(${campo}, '%Y%m%d')
    )
  `;
}

function toYmdCompact(dataIso) {
  return String(dataIso || '').replace(/-/g, '');
}

function normalizarData(data) {
  if (!data) return null;
  const text = String(data).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return null;
}

function normalizeBarcode(value) {
  const barcode = normalizeText(value);
  if (!barcode) return '';
  const upper = barcode.toUpperCase();
  if (upper === 'SEM GTIN' || upper === 'SEM_GTIN') return '';
  return barcode;
}

function variantesBarcode(value) {
  const code = normalizeBarcode(value);
  if (!code) return [];
  const set = new Set([code]);
  const digits = normalizeDigits(code);
  if (digits) {
    set.add(digits);
    if (digits.length === 14 && (digits.startsWith('1') || digits.startsWith('0'))) {
      set.add(digits.slice(1));
    }
  }
  return [...set];
}

function barcodesDoXml(item) {
  return [...new Set([
    ...variantesBarcode(item.cEAN),
    ...variantesBarcode(item.cEANTrib)
  ])];
}

function barcodesDoCadastro(cad) {
  return [...new Set([
    ...variantesBarcode(cad.barra1),
    ...variantesBarcode(cad.barra2),
    ...variantesBarcode(cad.barra3)
  ])];
}

function agregarItemXml(mixXml, mixBarras, item, chaveNf) {
  const chaveCod = normalizeCodigo(item.cProd);
  const barras = barcodesDoXml(item);
  if (!chaveCod && barras.length === 0) return;

  let agg = chaveCod ? mixXml.get(chaveCod) : null;
  if (!agg) {
    for (const barra of barras) {
      if (mixBarras.has(barra)) {
        agg = mixBarras.get(barra);
        break;
      }
    }
  }
  if (!agg) {
    agg = {
      chave_norm: chaveCod || barras[0],
      cProd: item.cProd,
      xProd: item.xProd,
      uCom: item.uCom,
      uTrib: item.uTrib,
      cEAN: item.cEAN || item.cEANTrib || '',
      cEANTrib: item.cEANTrib || '',
      qtd_nfs: 0,
      chaves: new Set()
    };
  }

  if (chaveCod) {
    for (const variante of variantesCodigo(item.cProd)) {
      if (!mixXml.has(variante)) mixXml.set(variante, agg);
    }
    mixXml.set(chaveCod, agg);
  }
  for (const barra of barras) {
    if (!mixBarras.has(barra)) mixBarras.set(barra, agg);
  }

  if (!agg.chaves.has(chaveNf)) {
    agg.chaves.add(chaveNf);
    agg.qtd_nfs += 1;
  }

  if (item.xProd) agg.xProd = item.xProd;
  if (item.uCom) agg.uCom = item.uCom;
  if (item.uTrib) agg.uTrib = item.uTrib;
  if (item.cEAN || item.cEANTrib) agg.cEAN = item.cEAN || item.cEANTrib;
  if (item.cEANTrib) agg.cEANTrib = item.cEANTrib;
  if (item.cProd) agg.cProd = item.cProd;
}

function acharNoXml(mixXml, codfor) {
  for (const variante of variantesCodigo(codfor)) {
    const hit = mixXml.get(variante);
    if (hit) return hit;
  }
  return null;
}

function acharPorBarra(mixBarras, cad) {
  for (const barra of barcodesDoCadastro(cad)) {
    const hit = mixBarras.get(barra);
    if (hit) return { agg: hit, barra };
  }
  return null;
}

function indexarItemcomp(rows) {
  const porReffor = new Map();
  const porNsu = new Map();
  const lista = [];
  const vistos = new Set();

  for (const row of rows || []) {
    const reffor = normalizeText(row.REFFOR || row.reffor);
    const nsu = normalizeText(row.NSU || row.nsu);
    const chave = `${normalizeCodigo(reffor) || ''}|${nsu}`;
    if (vistos.has(chave)) {
      const existente = porReffor.get(normalizeCodigo(reffor)) || porNsu.get(nsu);
      if (existente) existente.qtd += Number(row.qtd_lanc || 1);
      continue;
    }
    vistos.add(chave);

    const item = {
      reffor,
      nsu,
      qtd: Number(row.qtd_lanc || 1),
      chave_exemplo: normalizeText(row.chave_exemplo)
    };
    lista.push(item);

    if (temCodfor(reffor)) {
      for (const variante of variantesCodigo(reffor)) {
        if (!porReffor.has(variante)) porReffor.set(variante, item);
      }
    }
    if (nsu && !porNsu.has(nsu)) porNsu.set(nsu, item);
  }

  return { lista, porReffor, porNsu };
}

function acharNoItemcomp(index, cad) {
  if (temCodfor(cad.codfor)) {
    for (const variante of variantesCodigo(cad.codfor)) {
      const hit = index.porReffor.get(variante);
      if (hit) return { item: hit, origem: 'reffor' };
    }
  }
  const nsu = normalizeText(cad.nsu);
  if (nsu && index.porNsu.has(nsu)) {
    return { item: index.porNsu.get(nsu), origem: 'nsu' };
  }
  return null;
}

function temCodfor(value) {
  const code = normalizeText(value);
  return !!(code && code !== '0');
}

function indexarTabfor(rows) {
  const porChave = new Map();
  const lista = [];
  const vistos = new Set();

  for (const row of rows || []) {
    const codfor = normalizeText(row.CODFOR);
    const nsu = normalizeText(row.NSU);
    const registro = String(row.REGISTRO ?? '');
    const chaveNorm = temCodfor(codfor) ? normalizeCodigo(codfor) : '';
    const chaveUnica = chaveNorm
      ? `cod:${chaveNorm}`
      : `nsu:${nsu || registro || lista.length}`;

    if (vistos.has(chaveUnica)) continue;
    vistos.add(chaveUnica);

    const item = {
      registro: row.REGISTRO,
      fornece: normalizeText(row.FORNECE),
      codfor,
      nsu,
      plu: normalizeText(row.plu || row.embalagem_plu),
      barra1: normalizeText(row.barra1 || row.BARRA1),
      barra2: normalizeText(row.barra2 || row.BARRA2),
      barra3: normalizeText(row.barra3 || row.BARRA3),
      fatorfor: row.FATORFOR == null ? null : parseDecimal(row.FATORFOR, 4),
      embfor: normalizeText(row.EMBFOR),
      undfor: normalizeText(row.UNDFOR),
      erp_codigo: row.erp_codigo || null,
      descricao_sac: normalizeText(row.descricao_sac),
      erp_unidade: normalizeText(row.erp_unidade)
    };

    lista.push(item);

    if (temCodfor(codfor)) {
      for (const variante of variantesCodigo(codfor)) {
        if (!porChave.has(variante)) {
          porChave.set(variante, item);
        }
      }
    }
  }

  const porBarra = new Map();
  for (const item of lista) {
    for (const barra of barcodesDoCadastro(item)) {
      if (!porBarra.has(barra)) porBarra.set(barra, item);
    }
  }

  return { lista, porChave, porBarra };
}

module.exports = function registerMixFornecedorRoutes(app, options = {}) {
  const {
    getPool,
    xml2js,
    dataEmissaoExpr = montarExpressaoDataLocal('n.EMISSAO'),
    capNfs = CAP_NFS
  } = options;

  app.get('/api/mix-fornecedor/fornecedores', async (req, res) => {
    try {
      const q = normalizeText(req.query.q);
      if (q.length < 2) {
        return res.json([]);
      }

      const pool = getPool();
      const like = `%${q}%`;
      const digits = normalizeDigits(q);
      const likeDigits = digits ? `%${digits}%` : like;

      let rows = [];
      try {
        const sql = `
          SELECT DISTINCT
            f.CNPJ AS cnpj,
            COALESCE(NULLIF(TRIM(f.FANTASIA), ''), NULLIF(TRIM(f.RAZAO), ''), f.CNPJ) AS nome
          FROM sac.fornece f
          WHERE f.CNPJ IS NOT NULL AND f.CNPJ <> ''
            AND (
              f.CNPJ LIKE ?
              OR f.CNPJ LIKE ?
              OR COALESCE(f.FANTASIA, '') LIKE ?
              OR COALESCE(f.RAZAO, '') LIKE ?
            )
          ORDER BY nome ASC
          LIMIT 30
        `;
        const [result] = await pool.query(sql, [like, likeDigits, like, like]);
        rows = result || [];
      } catch (errFornece) {
        console.warn('[mix-fornecedor] busca em fornece falhou:', errFornece.message);
      }

      if (!rows.length) {
        const sqlTabfor = `
          SELECT DISTINCT
            tabfor.FORNECE AS cnpj,
            COALESCE(
              NULLIF(TRIM(f.FANTASIA), ''),
              NULLIF(TRIM(f.RAZAO), ''),
              tabfor.FORNECE
            ) AS nome
          FROM sac.tabfor
          LEFT JOIN sac.fornece f ON f.CNPJ = tabfor.FORNECE
          WHERE tabfor.FORNECE IS NOT NULL AND tabfor.FORNECE <> ''
            AND (
              tabfor.FORNECE LIKE ?
              OR tabfor.FORNECE LIKE ?
              OR COALESCE(f.FANTASIA, '') LIKE ?
              OR COALESCE(f.RAZAO, '') LIKE ?
            )
          ORDER BY nome ASC
          LIMIT 30
        `;
        const [result] = await pool.query(sqlTabfor, [like, likeDigits, like, like]);
        rows = result || [];
      }

      res.json(rows.map((row) => ({
        cnpj: padCnpj(row.cnpj) || normalizeText(row.cnpj),
        nome: normalizeText(row.nome) || normalizeText(row.cnpj)
      })));
    } catch (error) {
      console.error('[mix-fornecedor] erro ao buscar fornecedores:', error);
      res.status(500).json({ error: 'Falha ao buscar fornecedores.' });
    }
  });

  app.get('/api/mix-fornecedor/conferir', async (req, res) => {
    try {
      if (!xml2js) {
        return res.status(503).json({ error: 'xml2js não disponível no servidor.' });
      }

      const fornecedorRaw = normalizeText(req.query.fornecedor);
      const fornecedor = padCnpj(fornecedorRaw) || normalizeDigits(fornecedorRaw);
      const dataInicial = normalizarData(req.query.data_inicial);
      const dataFinal = normalizarData(req.query.data_final);
      const estab = padCnpj(req.query.estab) || normalizeDigits(req.query.estab || '');

      if (!fornecedor || fornecedor.length < 11) {
        return res.status(400).json({ error: 'Informe o CNPJ/CPF do fornecedor.' });
      }
      if (!dataInicial || !dataFinal) {
        return res.status(400).json({ error: 'Informe data_inicial e data_final válidas.' });
      }

      const pool = getPool();
      const fornecedorVariants = [...new Set([
        fornecedor,
        fornecedorRaw,
        normalizeDigits(fornecedorRaw),
        padCnpj(fornecedorRaw)
      ].filter(Boolean))];

      const placeholdersFornece = fornecedorVariants.map(() => '?').join(', ');
      const sqlTabfor = `
        SELECT
          tabfor.REGISTRO,
          tabfor.FORNECE,
          tabfor.CODFOR,
          tabfor.NSU,
          tabfor.FATORFOR,
          tabfor.EMBFOR,
          tabfor.UNDFOR,
          produto.codigo AS erp_codigo,
          TRIM(CONCAT(
            COALESCE(produto.DESCRICAO, produto.descricao, ''),
            ' ',
            COALESCE(embalagem.DESCRICAO, embalagem.descricao, '')
          )) AS descricao_sac,
          COALESCE(embalagem.UNIDADE, embalagem.Unidade, '') AS erp_unidade,
          embalagem.BARRA1 AS barra1,
          embalagem.BARRA2 AS barra2,
          embalagem.BARRA3 AS barra3,
          CONCAT(
            COALESCE(embalagem.PLU, embalagem.CODPRODUTO),
            '-',
            calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))
          ) AS plu
        FROM sac.tabfor
        LEFT JOIN sac.embalagem ON embalagem.CODPRODUTO = tabfor.NSU
        LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
        WHERE tabfor.FORNECE IN (${placeholdersFornece})
        ORDER BY
          CASE WHEN TRIM(COALESCE(tabfor.CODFOR, '')) IN ('', '0') THEN 1 ELSE 0 END,
          tabfor.CODFOR ASC,
          tabfor.REGISTRO ASC
      `;
      const [tabforRows] = await pool.query(sqlTabfor, fornecedorVariants);
      const { lista: mixCadastro, porChave: tabforPorCodigo, porBarra: tabforPorBarra } = indexarTabfor(tabforRows);

      const dataInicialCompact = toYmdCompact(dataInicial);
      const dataFinalCompact = toYmdCompact(dataFinal);

      const filtrosNf = [
        `(
          DATE(${dataEmissaoExpr}) BETWEEN ? AND ?
          OR (
            n.EMISSAO REGEXP '^[0-9]{8}$'
            AND n.EMISSAO BETWEEN ? AND ?
          )
        )`,
        'COALESCE(n.SITNFE, 1) = 1',
        `(
          REPLACE(REPLACE(REPLACE(n.CNPJ_CPF, '.', ''), '/', ''), '-', '') IN (${fornecedorVariants.map(() => '?').join(', ')})
          OR n.CNPJ_CPF IN (${fornecedorVariants.map(() => '?').join(', ')})
        )`
      ];
      const valoresNf = [
        dataInicial,
        dataFinal,
        dataInicialCompact,
        dataFinalCompact,
        ...fornecedorVariants,
        ...fornecedorVariants
      ];

      if (estab) {
        filtrosNf.push(`(
          REPLACE(REPLACE(REPLACE(COALESCE(n.ESTAB, ''), '.', ''), '/', ''), '-', '') = ?
          OR n.ESTAB = ?
        )`);
        valoresNf.push(estab, estab);
      }

      const sqlCount = `
        SELECT COUNT(*) AS total
        FROM nfe_xml n
        WHERE ${filtrosNf.join(' AND ')}
      `;
      const [countRows] = await pool.query(sqlCount, valoresNf);
      const totalNfsPeriodo = Number(countRows?.[0]?.total || 0);

      const sqlNfs = `
        SELECT n.CHAVE, n.XML, n.EMISSAO, n.ESTAB, n.RAZAO
        FROM nfe_xml n
        WHERE ${filtrosNf.join(' AND ')}
        ORDER BY ${dataEmissaoExpr} DESC, n.IDNFE_XML DESC
        LIMIT ${Number(capNfs) || CAP_NFS}
      `;
      const [nfs] = await pool.query(sqlNfs, valoresNf);

      const parser = criarParser(xml2js);
      const mixXml = new Map();
      const mixBarras = new Map();
      let nfsParseadas = 0;
      let nfsComErro = 0;

      for (const nf of nfs || []) {
        const chave = normalizeText(nf.CHAVE);
        const xml = nf.XML;
        if (!xml) {
          nfsComErro += 1;
          continue;
        }
        try {
          const parsed = await parser.parseStringPromise(xml);
          const infNFe = extrairInfNfe(parsed);
          const itens = extrairItensXml(infNFe);
          for (const item of itens) {
            agregarItemXml(mixXml, mixBarras, item, chave);
          }
          nfsParseadas += 1;
        } catch (parseErr) {
          nfsComErro += 1;
          console.warn(`[mix-fornecedor] falha ao parsear XML ${chave}:`, parseErr.message);
        }
      }

      const dataCompraExpr = montarExpressaoDataLocal('c.EMISSAO');
      const filtrosItemcomp = [
        `(
          DATE(${dataCompraExpr}) BETWEEN ? AND ?
          OR (
            c.EMISSAO REGEXP '^[0-9]{8}$'
            AND c.EMISSAO BETWEEN ? AND ?
          )
        )`,
        `(
          REPLACE(REPLACE(REPLACE(ic.FORNECE, '.', ''), '/', ''), '-', '') IN (${fornecedorVariants.map(() => '?').join(', ')})
          OR ic.FORNECE IN (${fornecedorVariants.map(() => '?').join(', ')})
        )`
      ];
      const valoresItemcomp = [
        dataInicial,
        dataFinal,
        dataInicialCompact,
        dataFinalCompact,
        ...fornecedorVariants,
        ...fornecedorVariants
      ];
      if (estab) {
        filtrosItemcomp.push(`(
          REPLACE(REPLACE(REPLACE(COALESCE(ic.ESTAB, ''), '.', ''), '/', ''), '-', '') = ?
          OR ic.ESTAB = ?
        )`);
        valoresItemcomp.push(estab, estab);
      }

      let itemcompIndex = { lista: [], porReffor: new Map(), porNsu: new Map() };
      try {
        const sqlItemcomp = `
          SELECT
            ic.REFFOR,
            ic.NSU,
            COUNT(*) AS qtd_lanc,
            MAX(c.CHAVE_NFE) AS chave_exemplo
          FROM itemcomp ic
          INNER JOIN compra c
            ON c.FORNECE = ic.FORNECE
           AND c.ESTAB = ic.ESTAB
           AND (c.NUMERO = ic.NUMERO OR CAST(c.NUMERO AS CHAR) = CAST(ic.NUMERO AS CHAR))
          WHERE ${filtrosItemcomp.join(' AND ')}
          GROUP BY ic.REFFOR, ic.NSU
        `;
        const [itemcompRows] = await pool.query(sqlItemcomp, valoresItemcomp);
        itemcompIndex = indexarItemcomp(itemcompRows);
      } catch (errItemcomp) {
        console.warn('[mix-fornecedor] consulta itemcomp falhou:', errItemcomp.message);
      }

      const usadosXml = new Set();
      const usadosItemcomp = new Set();
      const itens = [];

      for (const cad of mixCadastro) {
        const temReferencia = temCodfor(cad.codfor);
        let matchXml = temReferencia ? acharNoXml(mixXml, cad.codfor) : null;
        let origemMatch = matchXml ? 'codfor' : null;
        let barraMatch = null;
        let matchItemcomp = null;

        if (!matchXml) {
          const hitBarra = acharPorBarra(mixBarras, cad);
          if (hitBarra) {
            matchXml = hitBarra.agg;
            origemMatch = 'ean';
            barraMatch = hitBarra.barra;
          }
        }

        if (!matchXml) {
          matchItemcomp = acharNoItemcomp(itemcompIndex, cad);
          if (matchItemcomp) origemMatch = 'itemcomp';
        }

        if (!matchXml && !matchItemcomp) {
          itens.push({
            status: 'divergente',
            motivos: temReferencia
              ? ['CODFOR/EAN não aparecem no XML nem no lançamento (itemcomp) do período']
              : ['Item na tabfor sem CODFOR e sem EAN/NSU correspondente no XML ou itemcomp'],
            codfor: cad.codfor,
            cProd: null,
            nsu: cad.nsu,
            plu: cad.plu || null,
            descricao_sac: cad.descricao_sac,
            xProd: null,
            undfor: cad.undfor,
            embfor: cad.embfor,
            fatorfor: cad.fatorfor,
            erp_unidade: cad.erp_unidade,
            erp_codigo: cad.erp_codigo,
            uCom: null,
            uTrib: null,
            cEAN: cad.barra1 || cad.barra2 || cad.barra3 || null,
            qtd_nfs: 0,
            chave_exemplo: null
          });
          continue;
        }

        if (matchXml) usadosXml.add(matchXml.chave_norm);
        if (matchItemcomp) {
          usadosItemcomp.add(`${normalizeCodigo(matchItemcomp.item.reffor)}|${matchItemcomp.item.nsu}`);
        }

        const fonte = matchXml || {};
        const chaveExemplo = matchXml?.chaves?.size
          ? [...matchXml.chaves][0]
          : (matchItemcomp?.item.chave_exemplo || null);

        let motivoOk = 'CODFOR encontrado no XML (cProd)';
        if (origemMatch === 'ean') motivoOk = `EAN da embalagem encontrado no XML (${barraMatch})`;
        if (origemMatch === 'itemcomp') {
          motivoOk = matchItemcomp.origem === 'nsu'
            ? `NSU encontrado no lançamento (itemcomp ${matchItemcomp.item.nsu})`
            : `CODFOR encontrado no lançamento (itemcomp.REFFOR ${matchItemcomp.item.reffor})`;
        }

        itens.push({
          status: 'ok',
          motivos: [motivoOk],
          codfor: cad.codfor,
          cProd: fonte.cProd || matchItemcomp?.item.reffor || null,
          nsu: cad.nsu,
          plu: cad.plu || null,
          descricao_sac: cad.descricao_sac,
          xProd: fonte.xProd || null,
          undfor: cad.undfor,
          embfor: cad.embfor,
          fatorfor: cad.fatorfor,
          erp_unidade: cad.erp_unidade,
          erp_codigo: cad.erp_codigo,
          uCom: fonte.uCom || null,
          uTrib: fonte.uTrib || null,
          cEAN: fonte.cEAN || barraMatch || null,
          qtd_nfs: fonte.qtd_nfs || matchItemcomp?.item.qtd || 0,
          chave_exemplo: chaveExemplo
        });
      }

      const xmlUnicos = [];
      const vistosXml = new Set();
      for (const xmlAgg of [...mixXml.values(), ...mixBarras.values()]) {
        if (!xmlAgg || vistosXml.has(xmlAgg.chave_norm)) continue;
        vistosXml.add(xmlAgg.chave_norm);
        xmlUnicos.push(xmlAgg);
      }

      for (const xmlAgg of xmlUnicos) {
        if (usadosXml.has(xmlAgg.chave_norm)) continue;
        if (variantesCodigo(xmlAgg.cProd).some((v) => tabforPorCodigo.has(v))) continue;
        if (barcodesDoXml(xmlAgg).some((b) => tabforPorBarra.has(b))) continue;
        if (variantesCodigo(xmlAgg.cProd).some((v) => itemcompIndex.porReffor.has(v))) continue;

        const chaveExemplo = xmlAgg.chaves.size ? [...xmlAgg.chaves][0] : null;
        itens.push({
          status: 'so_notas',
          motivos: ['cProd/EAN do XML sem correspondência na tabfor (informativo)'],
          codfor: null,
          cProd: xmlAgg.cProd,
          nsu: null,
          plu: null,
          descricao_sac: null,
          xProd: xmlAgg.xProd,
          undfor: null,
          embfor: null,
          fatorfor: null,
          erp_unidade: null,
          erp_codigo: null,
          uCom: xmlAgg.uCom,
          uTrib: xmlAgg.uTrib,
          cEAN: xmlAgg.cEAN,
          qtd_nfs: xmlAgg.qtd_nfs,
          chave_exemplo: chaveExemplo
        });
      }

      for (const lanc of itemcompIndex.lista) {
        const chaveLanc = `${normalizeCodigo(lanc.reffor)}|${lanc.nsu}`;
        if (usadosItemcomp.has(chaveLanc)) continue;
        if (temCodfor(lanc.reffor) && variantesCodigo(lanc.reffor).some((v) => tabforPorCodigo.has(v))) continue;
        if (lanc.nsu && mixCadastro.some((cad) => cad.nsu === lanc.nsu)) continue;

        itens.push({
          status: 'so_notas',
          motivos: ['Lançado em itemcomp sem correspondência na tabfor (informativo)'],
          codfor: null,
          cProd: lanc.reffor,
          nsu: lanc.nsu,
          plu: null,
          descricao_sac: null,
          xProd: null,
          undfor: null,
          embfor: null,
          fatorfor: null,
          erp_unidade: null,
          erp_codigo: null,
          uCom: null,
          uTrib: null,
          cEAN: null,
          qtd_nfs: lanc.qtd,
          chave_exemplo: lanc.chave_exemplo || null
        });
      }

      const ordemStatus = { divergente: 0, so_notas: 1, ok: 2 };
      itens.sort((a, b) => {
        const sa = ordemStatus[a.status] ?? 9;
        const sb = ordemStatus[b.status] ?? 9;
        if (sa !== sb) return sa - sb;
        return String(a.codfor || a.cProd || '').localeCompare(String(b.codfor || b.cProd || ''));
      });

      const resumo = {
        divergente: 0,
        so_notas: 0,
        ok: 0,
        total_itens: itens.length,
        total_tabfor: mixCadastro.length,
        total_codigos_xml: xmlUnicos.length,
        nfs_periodo: totalNfsPeriodo,
        nfs_analisadas: nfsParseadas,
        nfs_com_erro: nfsComErro,
        limite_atingido: totalNfsPeriodo > (Number(capNfs) || CAP_NFS),
        cap_nfs: Number(capNfs) || CAP_NFS
      };

      for (const item of itens) {
        if (resumo[item.status] != null) resumo[item.status] += 1;
      }

      let aviso = null;
      if (resumo.nfs_analisadas === 0) {
        aviso = 'Nenhuma NF do fornecedor foi encontrada no período. Todos os CODFOR da tabfor aparecem como divergência. Amplie ou ajuste as datas.';
      } else if (resumo.limite_atingido) {
        aviso = `Período tem ${totalNfsPeriodo} NFs; foram analisadas as ${resumo.cap_nfs} mais recentes.`;
      }

      res.json({
        fornecedor,
        data_inicial: dataInicial,
        data_final: dataFinal,
        estab: estab || null,
        aviso,
        resumo,
        itens
      });
    } catch (error) {
      console.error('[mix-fornecedor] erro na conferência:', error);
      res.status(500).json({ error: 'Falha ao conferir mix do fornecedor.', detalhe: error.message });
    }
  });
};
