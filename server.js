const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const path = require('path');
const {
    consultarXmlPorChave,
    consultarStatusPorChave,
    diagnosticarCertificados,
    listarCertificadosParaUI,
    formatarErroRespostaSefaz,
} = require('./sefaz-service');
const { extrairDadosNFe } = require('./nfe-parser');
const registerConfNfRoutes = require('./confnf-api');
let xml2js;
try {
    xml2js = require('xml2js');
} catch (error) {
    console.error('AVISO: xml2js não está instalado. Execute: npm install xml2js');
    console.error('A funcionalidade de detalhamento de NF-e não estará disponível até que o módulo seja instalado.');
}
require('dotenv').config();

let updater = null;
try {
    updater = require('./updater');
} catch (e) {
    console.warn('[INFO] Modulo updater nao encontrado. Auto-update desativado.');
}

const app = express();
// Aumentar limite para XMLs grandes (100mb)
app.use(express.json({ limit: '100mb' }));
app.use(express.text({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
const PORT = process.env.PORT || 3000;
const UPDATE_TOKEN_ADMIN = process.env.UPDATE_ADMIN_TOKEN || '';

// ============================================
// GERENCIAMENTO DE MÚLTIPLOS SERVIDORES
// ============================================

// Objeto para armazenar os pools de conexão
const serverPools = {};
const serverConfigs = {};
let currentServer = null;

// Função para carregar configurações dos servidores do .env
function carregarServidores() {
    const serversEnv = process.env.SERVERS;
    
    if (serversEnv) {
        // Novo formato com múltiplos servidores
        const serverIds = serversEnv.split(',').map(s => s.trim());
        
        serverIds.forEach(serverId => {
            const config = {
                id: serverId,
                name: process.env[`SERVER_${serverId}_NAME`] || serverId,
                host: process.env[`SERVER_${serverId}_HOST`] || 'localhost',
                user: process.env[`SERVER_${serverId}_USER`] || 'root',
                password: process.env[`SERVER_${serverId}_PASSWORD`] || 'root',
                database: process.env[`SERVER_${serverId}_DATABASE`] || 'sac',
                connectionLimit: Number(process.env[`SERVER_${serverId}_CONNECTION_LIMIT`]) || 5
            };
            
            serverConfigs[serverId] = config;
            
            // Criar pool para este servidor
            serverPools[serverId] = mysql.createPool({
                host: config.host,
                user: config.user,
                password: config.password,
                database: config.database,
                waitForConnections: true,
                connectionLimit: config.connectionLimit,
                timezone: 'Z',
                enableKeepAlive: true,
                keepAliveInitialDelay: 0
            });
            
            console.log(`[INFO] Servidor configurado: ${config.name} (${serverId})`);
        });
        
        // Definir servidor padrão
        currentServer = process.env.DEFAULT_SERVER || serverIds[0];
    } else {
        // Formato legado (compatibilidade com configuração antiga)
        const config = {
            id: 'default',
            name: 'Servidor Padrão',
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'root',
            database: process.env.DB_NAME || 'sac',
            connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 5
        };
        
        serverConfigs['default'] = config;
        
        serverPools['default'] = mysql.createPool({
            host: config.host,
            user: config.user,
            password: config.password,
            database: config.database,
            waitForConnections: true,
            connectionLimit: config.connectionLimit,
            timezone: 'Z',
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });
        
        currentServer = 'default';
        console.log('[INFO] Usando configuração legada (servidor único)');
    }
    
    console.log(`[INFO] Servidor padrão: ${currentServer}`);
}

/**
 * Expõe desconto/ODA com chaves estáveis para o front (detalhes.html).
 * mysql2 pode devolver nomes em maiúsculas/minúsculas variadas; aliases ic_* (quando usados no SELECT) têm prioridade.
 */
function normalizarCamposItemcompParaFront(row) {
    if (!row || typeof row !== 'object') return;
    const keys = Object.keys(row);
    const getFirst = (cands) => {
        for (const c of cands) {
            const k = keys.find((x) => x.toLowerCase() === c.toLowerCase());
            if (k === undefined) continue;
            const v = row[k];
            if (v !== undefined && v !== null && v !== '') return v;
            if (v === 0 || v === 0n) return v;
        }
        return undefined;
    };
    let desc =
        row.ic_desconto ??
        row.ic_DESCONTO ??
        getFirst(['desconto', 'DESCONTO', 'desc_unit', 'DESC_UNIT', 'DESC_UNI', 'desc_uni', 'vlr_desc', 'VLR_DESC']);
    if (desc === undefined) {
        for (const k of keys) {
            const kl = k.toLowerCase();
            if (kl.includes('descricao') && !kl.includes('descont')) continue;
            if (
                kl === 'desconto' ||
                (kl.includes('descont') && !kl.includes('desoner')) ||
                /^desc[_]?unit|^vlr[_]?desc/i.test(kl)
            ) {
                const v = row[k];
                if (v !== undefined && v !== null && v !== '') {
                    desc = v;
                    break;
                }
                if (v === 0 || v === 0n) {
                    desc = v;
                    break;
                }
            }
        }
    }
    let odaVal = row.ic_oda ?? row.ic_ODA ?? getFirst(['ODA', 'oda', 'Oda']);
    if (odaVal === undefined) {
        for (const k of keys) {
            if (k.toLowerCase() === 'oda' || /^oda[_]/i.test(k)) {
                const v = row[k];
                if (v !== undefined && v !== null && v !== '') {
                    odaVal = v;
                    break;
                }
                if (v === 0 || v === 0n) {
                    odaVal = v;
                    break;
                }
            }
        }
    }
    if (desc !== undefined && desc !== null) {
        row.desconto = desc;
        row.DESCONTO = desc;
    }
    if (odaVal !== undefined && odaVal !== null) {
        row.ODA = odaVal;
        row.oda = odaVal;
    }
}

// Função para obter o pool atual ou um pool específico
function getPool(serverId = null) {
    const id = serverId || currentServer;
    if (!serverPools[id]) {
        throw new Error(`Servidor não encontrado: ${id}`);
    }
    return serverPools[id];
}

// Variável de compatibilidade (para código existente que usa 'pool' diretamente)
let pool;

// Carregar servidores ao iniciar
carregarServidores();
pool = getPool();

registerConfNfRoutes(app, {
    getPool: () => pool,
    xml2js
});

// Função para testar conexão com o banco de dados
async function testarConexao(serverId = null) {
    const targetPool = serverId ? getPool(serverId) : pool;
    const config = serverConfigs[serverId || currentServer];
    
    try {
        const connection = await targetPool.getConnection();
        await connection.ping();
        connection.release();
        console.log(`[INFO] Conexão com o servidor "${config.name}" estabelecida com sucesso!`);
        console.log(`[INFO] Host: ${config.host}`);
        console.log(`[INFO] Database: ${config.database}`);
        return true;
    } catch (error) {
        console.error('\n==================================================');
        console.error(`  ERRO DE CONEXÃO COM O SERVIDOR: ${config.name}`);
        console.error('==================================================\n');
        console.error('Detalhes do erro:');
        console.error(`  Código: ${error.code || 'DESCONHECIDO'}`);
        console.error(`  Mensagem: ${error.message || 'Sem mensagem'}`);
        console.error('\nPossíveis causas:');
        console.error('  1. MySQL/MariaDB não está rodando');
        console.error('  2. Credenciais incorretas no arquivo .env');
        console.error('  3. Host/porta incorretos');
        console.error('  4. Banco de dados não existe');
        console.error('  5. Firewall bloqueando a conexão');
        console.error('\nVerifique:');
        console.error(`  - Arquivo .env existe e está configurado?`);
        console.error(`  - HOST: ${config.host}`);
        console.error(`  - USER: ${config.user}`);
        console.error(`  - DATABASE: ${config.database}`);
        console.error(`  - PASSWORD: ${config.password ? '*** (configurado)' : '(não configurado)'}`);
        console.error('\n==================================================\n');
        return false;
    }
}

const DANFE_API_KEY = process.env.DANFE_API_KEY || 'bc045b03-cf17-488c-a03a-e0b716dfe377';
const DANFE_API_URL = process.env.DANFE_API_URL || 'https://api.meudanfe.com.br/v2';

const danfeClient = axios.create({
    baseURL: DANFE_API_URL,
    headers: {
        'api-key': DANFE_API_KEY,
        'Content-Type': 'application/json'
    },
    timeout: 20000
});

function montarExpressaoData(campo = 'EMISSAO') {
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

const DATA_EMISSAO_EXPR = montarExpressaoData('n.EMISSAO');

/**
 * Expressão SQL: CNPJ ou CPF do destinatário lido dentro de <dest>...</dest>.
 * Não usar o último <CNPJ> do XML inteiro — após <dest> costuma existir <infRespTec><CNPJ>, que quebraria o JOIN com ESTAB.
 */
function exprXmlDestDocumento(campoXml = 'n.XML') {
    const blocoDest = `SUBSTRING_INDEX(SUBSTRING_INDEX(${campoXml}, '<dest>', -1), '</dest>', 1)`;
    const cnpj = `NULLIF(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(${blocoDest}, '<CNPJ>', -1), '</CNPJ>', 1)), '')`;
    const cpf = `NULLIF(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(${blocoDest}, '<CPF>', -1), '</CPF>', 1)), '')`;
    return `COALESCE(${cnpj}, ${cpf})`;
}

const XML_DEST_DOCUMENTO_EXPR = exprXmlDestDocumento('n.XML');

function normalizarData(data) {
    if (!data) return null;
    if (/\d{4}-\d{2}-\d{2}/.test(data)) {
        return data;
    }
    const partes = data.split('/');
    if (partes.length !== 3) return null;
    const [dia, mes, ano] = partes.map((p) => p.padStart(2, '0'));
    return `${ano}-${mes}-${dia}`;
}

/** Normaliza CNPJ/CPF para apenas dígitos (para comparação consistente com ESTAB). */
function normalizarCnpjApenasDigitos(valor) {
    if (valor == null || typeof valor !== 'string') return '';
    return valor.replace(/\D/g, '').trim();
}

async function gerarDanfeViaXml(chave) {
    try {
        const [rows] = await pool.query(
            'SELECT XML FROM nfe_xml WHERE CHAVE = ? LIMIT 1',
            [chave]
        );
        const xml = rows?.[0]?.XML;
        if (!xml) {
            return null;
        }
        const response = await danfeClient.post(
            '/fd/convert/xml-to-da',
            xml,
            {
                headers: {
                    'Content-Type': 'text/plain'
                }
            }
        );
        const base64Pdf = response?.data?.data;
        if (!base64Pdf) {
            return null;
        }
        return {
            buffer: Buffer.from(base64Pdf, 'base64'),
            filename: response?.data?.name || `danfe-${chave}.pdf`
        };
    } catch (error) {
        console.error('Erro ao converter DANFE via XML:', error?.response?.data || error.message);
        return null;
    }
}

// Rota para obter contagem por status da compra
app.get('/status-compra-contagem', async (req, res) => {
    const { data_inicial, data_final, estabelecimento, tipo_nf } = req.query;
    const inicio = normalizarData(data_inicial);
    const fim = normalizarData(data_final);

    if (!inicio || !fim) {
        return res.status(400).json({ error: 'Informe datas válidas.' });
    }

    const filtros = [
        `DATE(${DATA_EMISSAO_EXPR}) BETWEEN ? AND ?`,
        'n.SITNFE = 1'
    ];
    const valores = [inicio, fim];

    // Filtro por tipo de NF
    if (tipo_nf !== undefined && tipo_nf !== '' && tipo_nf !== null) {
        filtros.push("SUBSTRING_INDEX(SUBSTRING_INDEX(n.XML, '<tpNF>', -1), '</tpNF>', 1) = ?");
        valores.push(tipo_nf);
    }

    // Filtro por estabelecimento (igual à rota /consulta, usando CNPJ da tabela ESTAB associado)
    const estabelecimentoFiltrar = (estabelecimento || '').trim();
    if (estabelecimentoFiltrar) {
        filtros.push("e.CNPJ = ?");
        valores.push(estabelecimentoFiltrar);
    }

    try {
        // Query separada para cada status para maior precisão
        const baseWhere = filtros.join(' AND ');
        
        // Total geral
        const [totalRows] = await pool.query(`
            SELECT COUNT(*) AS quantidade
            FROM nfe_xml n
            LEFT JOIN compra c ON c.CHAVE_NFE = n.CHAVE
            LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
                NULLIF(COALESCE(c.ESTAB, ''), ''),
                ${XML_DEST_DOCUMENTO_EXPR}
            )
            WHERE ${baseWhere}
        `, valores);
        
        // Pendentes (não lançadas)
        const [pendenteRows] = await pool.query(`
            SELECT COUNT(*) AS quantidade
            FROM nfe_xml n
            LEFT JOIN compra c ON c.CHAVE_NFE = n.CHAVE
            LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
                NULLIF(COALESCE(c.ESTAB, ''), ''),
                ${XML_DEST_DOCUMENTO_EXPR}
            )
            WHERE ${baseWhere} AND c.CHAVE_NFE IS NULL
        `, valores);
        
        // Status 0 - Não Conferida
        const [status0Rows] = await pool.query(`
            SELECT COUNT(*) AS quantidade
            FROM nfe_xml n
            INNER JOIN compra c ON c.CHAVE_NFE = n.CHAVE AND CAST(c.STATUS AS UNSIGNED) = 0
            LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
                NULLIF(COALESCE(c.ESTAB, ''), ''),
                ${XML_DEST_DOCUMENTO_EXPR}
            )
            WHERE ${baseWhere}
        `, valores);
        
        // Status 1 - Em Conferência
        const [status1Rows] = await pool.query(`
            SELECT COUNT(*) AS quantidade
            FROM nfe_xml n
            INNER JOIN compra c ON c.CHAVE_NFE = n.CHAVE AND CAST(c.STATUS AS UNSIGNED) = 1
            LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
                NULLIF(COALESCE(c.ESTAB, ''), ''),
                ${XML_DEST_DOCUMENTO_EXPR}
            )
            WHERE ${baseWhere}
        `, valores);
        
        // Status 2 - Na Recepção
        const [status2Rows] = await pool.query(`
            SELECT COUNT(*) AS quantidade
            FROM nfe_xml n
            INNER JOIN compra c ON c.CHAVE_NFE = n.CHAVE AND CAST(c.STATUS AS UNSIGNED) = 2
            LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
                NULLIF(COALESCE(c.ESTAB, ''), ''),
                ${XML_DEST_DOCUMENTO_EXPR}
            )
            WHERE ${baseWhere}
        `, valores);
        
        // Status 3 - Com Divergência
        const [status3Rows] = await pool.query(`
            SELECT COUNT(*) AS quantidade
            FROM nfe_xml n
            INNER JOIN compra c ON c.CHAVE_NFE = n.CHAVE AND CAST(c.STATUS AS UNSIGNED) = 3
            LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
                NULLIF(COALESCE(c.ESTAB, ''), ''),
                ${XML_DEST_DOCUMENTO_EXPR}
            )
            WHERE ${baseWhere}
        `, valores);
        
        // Status 4 - NF Recebida
        const [status4Rows] = await pool.query(`
            SELECT COUNT(*) AS quantidade
            FROM nfe_xml n
            INNER JOIN compra c ON c.CHAVE_NFE = n.CHAVE AND CAST(c.STATUS AS UNSIGNED) = 4
            LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
                NULLIF(COALESCE(c.ESTAB, ''), ''),
                ${XML_DEST_DOCUMENTO_EXPR}
            )
            WHERE ${baseWhere}
        `, valores);
        
        // Montar objeto com as contagens
        const contagens = {
            total: parseInt(totalRows[0]?.quantidade) || 0,
            pendente: parseInt(pendenteRows[0]?.quantidade) || 0,
            '0': parseInt(status0Rows[0]?.quantidade) || 0,
            '1': parseInt(status1Rows[0]?.quantidade) || 0,
            '2': parseInt(status2Rows[0]?.quantidade) || 0,
            '3': parseInt(status3Rows[0]?.quantidade) || 0,
            '4': parseInt(status4Rows[0]?.quantidade) || 0
        };
        
        // Log para debug
        console.log('[DEBUG] Contagem status_compra:', {
            periodo: `${inicio} a ${fim}`,
            filtros: baseWhere,
            contagens
        });
        
        res.json(contagens);
    } catch (error) {
        console.error('Erro ao buscar contagem de status:', error);
        res.status(500).json({ error: 'Erro ao buscar contagem de status.' });
    }
});

app.get('/consulta', async (req, res) => {
    const { data_inicial, data_final, fornecedor, numero, chave, status, usuario, estabelecimento, tipo_nf, status_compra } = req.query;
    const inicio = normalizarData(data_inicial);
    const fim = normalizarData(data_final);

    if (!inicio || !fim) {
        return res.status(400).json({ error: 'Informe datas válidas (formato dd/mm/aaaa ou aaaa-mm-dd).' });
    }
    const filtros = [
        `DATE(${DATA_EMISSAO_EXPR}) BETWEEN ? AND ?`,
        'n.SITNFE = 1'
    ];
    const valores = [inicio, fim];

    // Filtro por tipo de NF (0 = Entrada, 1 = Saída)
    if (tipo_nf !== undefined && tipo_nf !== '' && tipo_nf !== null) {
        // Extrair tpNF do XML usando SUBSTRING_INDEX
        filtros.push("SUBSTRING_INDEX(SUBSTRING_INDEX(n.XML, '<tpNF>', -1), '</tpNF>', 1) = ?");
        valores.push(tipo_nf);
    }

    if (status === 'lancada') {
        filtros.push('c.CHAVE_NFE IS NOT NULL');
    } else if (status === 'pendente') {
        filtros.push('c.CHAVE_NFE IS NULL');
    }

    // Campo unificado "Fornecedor" busca em CNPJ/CPF e Razão Social
    if (fornecedor) {
        filtros.push('(n.CNPJ_CPF LIKE ? OR n.RAZAO LIKE ?)');
        valores.push(`%${fornecedor}%`, `%${fornecedor}%`);
    }
    if (numero) {
        filtros.push("SUBSTRING(n.CHAVE, 26, 9) LIKE ?");
        valores.push(`%${numero}%`);
    }
    if (chave) {
        filtros.push('n.CHAVE LIKE ?');
        valores.push(`%${chave}%`);
    }
    if (usuario) {
        filtros.push('(CONCAT(c.USUARIO, calculo_digito(c.USUARIO)) LIKE ? OR f.NOME LIKE ?)');
        valores.push(`%${usuario}%`, `%${usuario}%`);
    }

    // Filtro por estabelecimento (usando sempre o CNPJ da tabela ESTAB associado à NF)
    const estabelecimentoNorm = normalizarCnpjApenasDigitos(estabelecimento);
    if (estabelecimentoNorm) {
        filtros.push("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(e.CNPJ,''), '.', ''), '/', ''), '-', ''), ' ', '') = ?");
        valores.push(estabelecimentoNorm);
    }

    // Filtro por status da compra
    if (status_compra !== undefined && status_compra !== '' && status_compra !== null) {
        if (status_compra === 'pendente') {
            // Pendente = não lançada (não existe na tabela compra)
            filtros.push('c.CHAVE_NFE IS NULL');
        } else {
            // Status numérico (0, 1, 2, 4)
            filtros.push('c.STATUS = ?');
            valores.push(status_compra);
        }
    }

    const sql = `
        SELECT 
            DATE_FORMAT(${DATA_EMISSAO_EXPR}, '%Y-%m-%d') AS EMISSAO_NORMALIZADA,
            n.EMISSAO AS EMISSAO_ORIGINAL, 
            n.CNPJ_CPF, 
            n.RAZAO, 
            n.CHAVE, 
            n.VALOR, 
            SUBSTRING(n.CHAVE, 26, 9) AS NUMERO_NF,
            CASE WHEN c.CHAVE_NFE IS NOT NULL THEN 1 ELSE 0 END AS LANCADA,
            c.NUMERO AS COMPRA_NUMERO,
            c.STATUS AS COMPRA_STATUS,
            CONCAT(c.USUARIO, calculo_digito(c.USUARIO)) AS USUARIO_CODIGO,
            f.NOME AS USUARIO_NOME,
            e.FANTASIA AS ESTAB_FANTASIA
        FROM nfe_xml n
        LEFT JOIN compra c ON c.CHAVE_NFE = n.CHAVE
        LEFT JOIN funciona f ON f.MATRICULA = c.USUARIO
        LEFT JOIN ESTAB e ON e.CNPJ = COALESCE(
            NULLIF(COALESCE(c.ESTAB, ''), ''),
            ${XML_DEST_DOCUMENTO_EXPR}
        )
        WHERE ${filtros.join(' AND ')}
        ORDER BY ${DATA_EMISSAO_EXPR} DESC, n.IDNFE_XML DESC
    `;

    try {
        const [rows] = await pool.query(sql, valores);
        res.json({
            data: rows,
            meta: {
                total: rows.length
            }
        });
    } catch (error) {
        console.error('Erro ao consultar notas:', error);
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ 
                error: 'Serviço temporariamente indisponível. Verifique a conexão com o banco de dados.' 
            });
        }
        res.status(500).json({ error: 'Falha ao consultar notas fiscais.' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/usuarios', async (req, res) => {
    try {
        const sql = `
            SELECT DISTINCT
                CONCAT(c.USUARIO, calculo_digito(c.USUARIO)) AS codigo,
                f.NOME AS nome
            FROM compra c
            LEFT JOIN funciona f ON f.MATRICULA = c.USUARIO
            WHERE c.USUARIO IS NOT NULL AND c.USUARIO <> ''
            ORDER BY nome ASC, codigo ASC
        `;
        const [rows] = await pool.query(sql);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao listar usuarios:', error);
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ 
                error: 'Serviço temporariamente indisponível. Verifique a conexão com o banco de dados.' 
            });
        }
        res.status(500).json({ error: 'Falha ao listar usuarios.' });
    }
});

// ============================================
// ENDPOINTS DE GERENCIAMENTO DE SERVIDORES
// ============================================

// Listar servidores disponíveis
app.get('/servidores', async (req, res) => {
    try {
        const servidores = Object.keys(serverConfigs).map(id => ({
            id,
            name: serverConfigs[id].name,
            host: serverConfigs[id].host,
            database: serverConfigs[id].database,
            atual: id === currentServer
        }));
        
        res.json({
            servidores,
            atual: currentServer
        });
    } catch (error) {
        console.error('Erro ao listar servidores:', error);
        res.status(500).json({ error: 'Erro ao listar servidores' });
    }
});

// Obter servidor atual
app.get('/servidor-atual', async (req, res) => {
    try {
        const config = serverConfigs[currentServer];
        res.json({
            id: currentServer,
            name: config.name,
            host: config.host,
            database: config.database
        });
    } catch (error) {
        console.error('Erro ao obter servidor atual:', error);
        res.status(500).json({ error: 'Erro ao obter servidor atual' });
    }
});

// Trocar de servidor
app.post('/trocar-servidor', async (req, res) => {
    try {
        const { serverId } = req.body;
        
        if (!serverId) {
            return res.status(400).json({ error: 'ID do servidor não informado' });
        }
        
        if (!serverConfigs[serverId]) {
            return res.status(404).json({ error: `Servidor "${serverId}" não encontrado` });
        }
        
        // Testar conexão com o novo servidor
        const conexaoOk = await testarConexao(serverId);
        
        if (!conexaoOk) {
            return res.status(500).json({ 
                error: `Não foi possível conectar ao servidor "${serverConfigs[serverId].name}"`,
                details: 'Verifique se o servidor está acessível e as credenciais estão corretas'
            });
        }
        
        // Trocar o servidor atual
        currentServer = serverId;
        pool = getPool(serverId);
        
        const config = serverConfigs[serverId];
        console.log(`[INFO] Servidor alterado para: ${config.name} (${serverId})`);
        
        res.json({
            success: true,
            message: `Conectado ao servidor "${config.name}"`,
            servidor: {
                id: serverId,
                name: config.name,
                host: config.host,
                database: config.database
            }
        });
    } catch (error) {
        console.error('Erro ao trocar servidor:', error);
        res.status(500).json({ error: 'Erro ao trocar servidor', details: error.message });
    }
});

// Testar conexão com um servidor específico
app.post('/testar-servidor', async (req, res) => {
    try {
        const { serverId } = req.body;
        
        if (!serverId) {
            return res.status(400).json({ error: 'ID do servidor não informado' });
        }
        
        if (!serverConfigs[serverId]) {
            return res.status(404).json({ error: `Servidor "${serverId}" não encontrado` });
        }
        
        const conexaoOk = await testarConexao(serverId);
        const config = serverConfigs[serverId];
        
        res.json({
            success: conexaoOk,
            servidor: {
                id: serverId,
                name: config.name,
                host: config.host,
                database: config.database
            },
            message: conexaoOk 
                ? `Conexão com "${config.name}" estabelecida com sucesso`
                : `Falha ao conectar com "${config.name}"`
        });
    } catch (error) {
        console.error('Erro ao testar servidor:', error);
        res.status(500).json({ error: 'Erro ao testar servidor', details: error.message });
    }
});

app.get('/estabelecimentos', async (req, res) => {
    try {
        // Primeiro tentar buscar da tabela ESTAB
        let sql = `
            SELECT DISTINCT
                e.CNPJ AS cnpj,
                COALESCE(e.FANTASIA, e.RAZAO, e.CNPJ) AS nome
            FROM ESTAB e
            WHERE e.CNPJ IS NOT NULL AND e.CNPJ <> ''
            ORDER BY nome ASC
        `;
        
        let [rows] = await pool.query(sql);
        
        // Se não retornar resultados, tentar buscar estabelecimentos das compras
        if (!rows || rows.length === 0) {
            sql = `
                SELECT DISTINCT
                    c.ESTAB AS cnpj,
                    COALESCE(e.FANTASIA, e.RAZAO, c.ESTAB) AS nome
                FROM compra c
                LEFT JOIN ESTAB e ON e.CNPJ = c.ESTAB
                WHERE c.ESTAB IS NOT NULL AND c.ESTAB <> ''
                ORDER BY nome ASC
            `;
            [rows] = await pool.query(sql);
        }
        
        res.json(rows || []);
    } catch (error) {
        console.error('Erro ao listar estabelecimentos:', error);
        console.error('Detalhes do erro:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ 
                error: 'Serviço temporariamente indisponível. Verifique a conexão com o banco de dados.' 
            });
        }
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.error('Tabela ESTAB não encontrada. Tentando buscar da tabela compra...');
            // Se a tabela ESTAB não existe, buscar apenas das compras
            try {
                const sqlCompra = `
                    SELECT DISTINCT
                        c.ESTAB AS cnpj,
                        c.ESTAB AS nome
                    FROM compra c
                    WHERE c.ESTAB IS NOT NULL AND c.ESTAB <> ''
                    ORDER BY c.ESTAB ASC
                `;
                const [rowsCompra] = await pool.query(sqlCompra);
                return res.json(rowsCompra || []);
            } catch (errorCompra) {
                console.error('Erro ao buscar estabelecimentos da compra:', errorCompra);
            }
        }
        res.status(500).json({ error: 'Falha ao listar estabelecimentos.' });
    }
});

app.get('/danfe/:chave', async (req, res) => {
    const { chave } = req.params;
    if (!/^\d{44}$/.test(chave)) {
        return res.status(400).json({ error: 'Informe uma chave com 44 dígitos.' });
    }
    if (!DANFE_API_KEY) {
        return res.status(500).json({ error: 'API key do DANFE não configurada.' });
    }

    const conversao = await gerarDanfeViaXml(chave);
    if (conversao?.buffer) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${conversao.filename}"`);
        return res.send(conversao.buffer);
    }

    try {
        await danfeClient.put(`/fd/add/${chave}`);
    } catch (error) {
        const status = error?.response?.status;
        if (status !== 409 && status !== 422) {
            console.error('Erro ao adicionar NF na área do cliente Meu Danfe:', error?.response?.data || error.message);
            return res.status(502).json({ error: 'Falha ao preparar DANFE na API externa.' });
        }
    }

    try {
        const pdfResponse = await danfeClient.get(`/fd/get/da/${chave}`, {
            responseType: 'arraybuffer',
            headers: { Accept: 'application/pdf' }
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="danfe-${chave}.pdf"`);
        return res.send(pdfResponse.data);
    } catch (error) {
        console.error('Erro ao baixar DANFE:', error?.response?.data || error.message);
        const status = error?.response?.status;
        return res.status(502).json({
            error: status === 404
                ? 'DANFE não encontrado na API externa.'
                : 'Falha ao gerar DANFE. Tente novamente.'
        });
    }
});

// ─────────────────────────────────────────────────────────────
// API de consulta SEFAZ por chave
// ─────────────────────────────────────────────────────────────

/** GET /api/sefaz/diagnostico?cnpj=14digitos → diagnóstico de certificados visíveis */
app.get('/api/sefaz/diagnostico', async (req, res) => {
    try {
        const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
        const info = await diagnosticarCertificados(cnpj || null);
        return res.json(info);
    } catch (error) {
        console.error('[SEFAZ diagnostico]', error?.message || error);
        return res.status(500).json({ erro: error?.message || 'Falha ao diagnosticar.' });
    }
});

/** GET /api/sefaz/certificados → lista certificados do Windows (para seleção manual) */
app.get('/api/sefaz/certificados', async (_req, res) => {
    try {
        const { certificados, debug } = await listarCertificadosParaUI();
        if (!certificados || certificados.length === 0) {
            console.warn('[SEFAZ certificados] Lista vazia. Debug:', debug);
        }
        return res.json({ certificados: certificados || [], debug });
    } catch (error) {
        console.error('[SEFAZ certificados]', error?.message || error);
        return res.status(500).json({ erro: error?.message || 'Falha ao listar certificados.' });
    }
});

/** GET /api/nfe/buscar?chave=44digitos&estab=CNPJ14  → verifica existência no banco */
app.get('/api/nfe/buscar', async (req, res) => {
    const chave = String(req.query.chave || '').replace(/\D/g, '');
    const estab = String(req.query.estab || '').replace(/\D/g, '');
    if (chave.length !== 44) {
        return res.status(400).json({ erro: 'Chave inválida. Informe os 44 dígitos.' });
    }
    try {
        const params = [chave];
        let sql = `SELECT IDNFE_XML, CHAVE, RAZAO, VALOR, EMISSAO, STATUS, TPNF, CNPJ_CPF, ESTAB
                   FROM nfe_xml WHERE CHAVE = ?`;
        if (estab) {
            sql += ' AND ESTAB = ?';
            params.push(estab);
        }
        sql += ' LIMIT 1';
        const [rows] = await pool.query(sql, params);
        if (!rows || rows.length === 0) {
            return res.json({ encontrado: false });
        }
        return res.json({ encontrado: true, nota: rows[0] });
    } catch (error) {
        console.error('[NFE buscar]', error?.message || error);
        return res.status(500).json({ erro: error?.message || 'Falha ao consultar base.' });
    }
});

/** POST /api/nfe/consultar-sefaz  body: { chave, estab, thumbprint? } → consulta SEFAZ e grava em nfe_xml */
app.post('/api/nfe/consultar-sefaz', async (req, res) => {
    const chaveRaw = (req.body && req.body.chave) || '';
    const estabRaw = (req.body && req.body.estab) || '';
    const thumbprint = ((req.body && req.body.thumbprint) || '').replace(/[^0-9A-Fa-f]/g, '') || null;
    const chave = String(chaveRaw).replace(/\D/g, '');
    const estab = String(estabRaw).replace(/\D/g, '');

    if (chave.length !== 44) {
        return res.status(400).json({ erro: 'Chave de acesso inválida.' });
    }
    if (!estab) {
        return res.status(400).json({ erro: 'Informe o estabelecimento (CNPJ).' });
    }

    try {
        const [rowsEstab] = await pool.query(
            'SELECT CNPJ, CERTIFICADO_NFE, UF FROM ESTAB WHERE CNPJ = ? LIMIT 1',
            [estab]
        );
        if (!rowsEstab || rowsEstab.length === 0) {
            return res.status(400).json({ erro: `Estabelecimento "${estab}" não encontrado em ESTAB.` });
        }
        const { CERTIFICADO_NFE, UF, CNPJ: codEstab } = rowsEstab[0];
        if (!CERTIFICADO_NFE) {
            return res.status(400).json({
                erro: 'Campo CERTIFICADO_NFE não preenchido para este estabelecimento.'
            });
        }
        if (!UF) {
            return res.status(400).json({ erro: 'Campo UF não preenchido para este estabelecimento.' });
        }

        const [jaExiste] = await pool.query(
            'SELECT IDNFE_XML FROM nfe_xml WHERE CHAVE = ? AND ESTAB = ? LIMIT 1',
            [chave, codEstab]
        );
        if (jaExiste && jaExiste.length > 0) {
            return res.json({
                origem: 'banco',
                mensagem: 'Esta chave já existe na base de dados.',
                idNfe: jaExiste[0].IDNFE_XML,
            });
        }

        const tpAmb = process.env.SEFAZ_TPAMB || '1';
        const { xml } = await consultarXmlPorChave(chave, CERTIFICADO_NFE, UF, { tpAmb, thumbprint });

        const [[maxIdRow]] = await pool.query(
            'SELECT COALESCE(MAX(IDNFE_XML), 0) AS maxId FROM nfe_xml'
        );
        const [[maxNsuRow]] = await pool.query(
            'SELECT COALESCE(MAX(NSU), 0) AS maxNsu FROM nfe_xml'
        );
        const proximoId = Number(maxIdRow?.maxId || 0) + 1;
        const proximoNsu = Number(maxNsuRow?.maxNsu || 0) + 1;

        const dados = extrairDadosNFe(xml, codEstab, proximoId, proximoNsu);

        await pool.query(
            `INSERT INTO nfe_xml
                (IDNFE_XML, NSU, CHAVE, RAZAO, TIPONFE, ESTAB, CNPJ_CPF, EMISSAO,
                 DHRECIBO, VALOR, TPNF, SITNFE, SITCONF, XML, STATUS, STATUS_MANIFESTO,
                 ERRO_MANIFESTO, ERRO, DATA_CIENCIA, DATA_MANIFESTO, PROTOCOLO_MANIFESTO)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                dados.IDNFE_XML, dados.NSU, dados.CHAVE,
                dados.RAZAO, dados.TIPONFE, dados.ESTAB,
                dados.CNPJ_CPF, dados.EMISSAO, dados.DHRECIBO,
                dados.VALOR, dados.TPNF, dados.SITNFE,
                dados.SITCONF, dados.XML, dados.STATUS,
                dados.STATUS_MANIFESTO, dados.ERRO_MANIFESTO, dados.ERRO,
                dados.DATA_CIENCIA, dados.DATA_MANIFESTO, dados.PROTOCOLO_MANIFESTO,
            ]
        );

        return res.json({
            origem: 'sefaz',
            idInserido: dados.IDNFE_XML,
            nsuInserido: dados.NSU,
            dados: {
                IDNFE_XML: dados.IDNFE_XML,
                NSU: dados.NSU,
                CHAVE: dados.CHAVE,
                RAZAO: dados.RAZAO,
                CNPJ_CPF: dados.CNPJ_CPF,
                VALOR: dados.VALOR,
                EMISSAO: dados.EMISSAO,
                STATUS: dados.STATUS,
                TPNF: dados.TPNF,
                ESTAB: dados.ESTAB,
            },
        });
    } catch (error) {
        console.error('[ConsultarSEFAZ]', error?.message || error);
        const fmt = formatarErroRespostaSefaz(error);
        return res.status(fmt.status).json(fmt.body);
    }
});

/**
 * POST /api/nfe/consultar-status-sefaz
 * body: { chave, estab, thumbprint? }
 * Consulta situação na SEFAZ e, se Cancelado, atualiza SAC.NFE_XML.SITNFE = 2.
 */
app.post('/api/nfe/consultar-status-sefaz', async (req, res) => {
    const chaveRaw = (req.body && req.body.chave) || '';
    const estabRaw = (req.body && req.body.estab) || '';
    const thumbprint = ((req.body && req.body.thumbprint) || '').replace(/[^0-9A-Fa-f]/g, '') || null;
    const chave = String(chaveRaw).replace(/\D/g, '');
    const estab = String(estabRaw).replace(/\D/g, '');

    if (chave.length !== 44) {
        return res.status(400).json({ erro: 'Chave de acesso inválida.' });
    }
    if (!estab) {
        return res.status(400).json({ erro: 'Informe o estabelecimento (CNPJ).' });
    }

    try {
        const [rowsEstab] = await pool.query(
            'SELECT CNPJ, CERTIFICADO_NFE, UF FROM ESTAB WHERE CNPJ = ? LIMIT 1',
            [estab]
        );
        if (!rowsEstab || rowsEstab.length === 0) {
            return res.status(400).json({ erro: `Estabelecimento "${estab}" não encontrado em ESTAB.` });
        }
        const { CERTIFICADO_NFE, UF, CNPJ: codEstab } = rowsEstab[0];
        if (!CERTIFICADO_NFE) {
            return res.status(400).json({
                erro: 'Campo CERTIFICADO_NFE não preenchido para este estabelecimento.'
            });
        }
        if (!UF) {
            return res.status(400).json({ erro: 'Campo UF não preenchido para este estabelecimento.' });
        }

        const [rowsNfe] = await pool.query(
            'SELECT IDNFE_XML, SITNFE FROM nfe_xml WHERE CHAVE = ? AND ESTAB = ? LIMIT 1',
            [chave, codEstab]
        );
        const registroBanco = rowsNfe && rowsNfe.length > 0 ? rowsNfe[0] : null;
        const sitnfeAnterior = registroBanco ? Number(registroBanco.SITNFE) : null;

        const tpAmb = process.env.SEFAZ_TPAMB || '1';
        const statusSefaz = await consultarStatusPorChave(chave, CERTIFICADO_NFE, UF, { tpAmb, thumbprint });

        let atualizado = false;
        let sitnfeAtual = sitnfeAnterior;
        let mensagem = `Situação na SEFAZ: ${statusSefaz.label}.`;

        if (statusSefaz.situacao === 'cancelada') {
            if (registroBanco) {
                if (sitnfeAnterior !== 2) {
                    await pool.query(
                        'UPDATE nfe_xml SET SITNFE = 2 WHERE CHAVE = ? AND ESTAB = ?',
                        [chave, codEstab]
                    );
                    atualizado = true;
                    sitnfeAtual = 2;
                    mensagem = 'NF-e cancelada na SEFAZ. Registro atualizado: SITNFE = 2.';
                } else {
                    mensagem = 'NF-e cancelada na SEFAZ. O registro já estava com SITNFE = 2.';
                }
            } else {
                mensagem = 'NF-e cancelada na SEFAZ, porém não há registro em NFE_XML para este estabelecimento (nada foi alterado).';
            }
        } else if (!registroBanco) {
            mensagem += ' Não há registro em NFE_XML para este estabelecimento.';
        } else if (statusSefaz.situacao === 'autorizada') {
            mensagem += ' Nenhuma alteração no banco (somente cancelamento atualiza SITNFE).';
        } else if (statusSefaz.situacao === 'denegada') {
            mensagem += ' Nenhuma alteração no banco (situação denegada).';
        } else {
            mensagem += ' Nenhuma alteração no banco (situação não identificada como cancelada).';
        }

        return res.json({
            situacaoSefaz: statusSefaz.situacao,
            situacaoLabel: statusSefaz.label,
            cStat: statusSefaz.cStat,
            xMotivo: statusSefaz.xMotivo,
            detalhe: statusSefaz.detalhe,
            existeNoBanco: !!registroBanco,
            idNfe: registroBanco ? registroBanco.IDNFE_XML : null,
            sitnfeAnterior,
            sitnfeAtual,
            atualizado,
            mensagem,
        });
    } catch (error) {
        console.error('[ConsultarStatusSEFAZ]', error?.message || error);
        const fmt = formatarErroRespostaSefaz(error);
        return res.status(fmt.status).json(fmt.body);
    }
});

app.get('/xml/:chave', async (req, res) => {
    const { chave } = req.params;
    
    if (!/^\d{44}$/.test(chave)) {
        return res.status(400).json({ error: 'Informe uma chave com 44 dígitos.' });
    }

    try {
        const [rows] = await pool.query(
            'SELECT XML FROM nfe_xml WHERE CHAVE = ? LIMIT 1',
            [chave]
        );
        
        if (!rows || rows.length === 0 || !rows[0]?.XML) {
            return res.status(404).json({ error: 'XML não encontrado no banco de dados para esta chave.' });
        }

        const xmlData = rows[0].XML;
        const filename = `nfe-${chave}.xml`;
        
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(xmlData);
    } catch (error) {
        console.error('Erro ao baixar XML do banco de dados:', error);
        return res.status(500).json({ error: 'Falha ao recuperar XML do banco de dados.' });
    }
});

app.get('/xml-editar/:chave', async (req, res) => {
    const { chave } = req.params;
    
    if (!/^\d{44}$/.test(chave)) {
        return res.status(400).json({ error: 'Informe uma chave com 44 dígitos.' });
    }

    try {
        const [rows] = await pool.query(
            'SELECT XML FROM nfe_xml WHERE CHAVE = ? LIMIT 1',
            [chave]
        );
        
        if (!rows || rows.length === 0 || !rows[0]?.XML) {
            return res.status(404).json({ error: 'XML não encontrado no banco de dados para esta chave.' });
        }

        const xmlData = rows[0].XML;
        return res.json({ xml: xmlData, chave });
    } catch (error) {
        console.error('Erro ao buscar XML para edição:', error);
        return res.status(500).json({ error: 'Falha ao recuperar XML do banco de dados.' });
    }
});

app.post('/xml-salvar/:chave', async (req, res) => {
    const { chave } = req.params;
    const { xml } = req.body;
    
    if (!/^\d{44}$/.test(chave)) {
        return res.status(400).json({ error: 'Informe uma chave com 44 dígitos.' });
    }

    if (!xml || typeof xml !== 'string') {
        return res.status(400).json({ error: 'XML inválido ou não fornecido.' });
    }

    // Log do tamanho do XML para debug
    const xmlSizeMB = (Buffer.byteLength(xml, 'utf8') / (1024 * 1024)).toFixed(2);
    console.log(`Tentando salvar XML de ${xmlSizeMB}MB para chave: ${chave}`);

    try {
        // Validar se o XML está bem formado antes de salvar
        if (xml2js) {
            try {
                await xml2js.parseStringPromise(xml);
            } catch (parseError) {
                return res.status(400).json({ error: 'XML malformado: ' + parseError.message });
            }
        }

        // Atualizar XML no banco
        await pool.query(
            'UPDATE nfe_xml SET XML = ? WHERE CHAVE = ?',
            [xml, chave]
        );

        console.log(`XML atualizado com sucesso (${xmlSizeMB}MB) para chave: ${chave}`);
        return res.json({ success: true, message: 'XML salvo com sucesso.' });
    } catch (error) {
        console.error('Erro ao salvar XML:', error);
        if (error.code === 'ER_NET_PACKET_TOO_LARGE') {
            return res.status(413).json({ error: `XML muito grande para o banco de dados. Tamanho: ${xmlSizeMB}MB. Verifique a configuração max_allowed_packet do MySQL.` });
        }
        return res.status(500).json({ error: 'Falha ao salvar XML no banco de dados: ' + error.message });
    }
});

// Busca de produtos (embalagem + produto) para vinculação no modal de autorização de recepção
app.get('/produtos/buscar', async (req, res) => {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q || q.length < 2) {
        return res.json([]);
    }
    const pool = getPool();
    const termo = '%' + q.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
    try {
        const [rows] = await pool.query(
            `SELECT embalagem.CODPRODUTO AS plu,
                    COALESCE(produto.descricao, produto.DESCRICAO, '') AS descricao,
                    COALESCE(embalagem.UNIDADE, embalagem.Unidade, produto.UNIDADE, produto.Unidade, '') AS unidade
             FROM embalagem
             LEFT JOIN produto ON produto.codigo = embalagem.PRODUTO
             WHERE embalagem.CODPRODUTO LIKE ?
                OR embalagem.BARRA1 LIKE ?
                OR embalagem.BARRA2 LIKE ?
                OR embalagem.BARRA3 LIKE ?
                OR COALESCE(produto.descricao, produto.DESCRICAO, '') LIKE ?
             ORDER BY embalagem.CODPRODUTO
             LIMIT 30`,
            [termo, termo, termo, termo, termo]
        );
        const list = (rows || []).map(r => ({
            plu: r.plu != null ? String(r.plu).trim() : '',
            descricao: (r.descricao != null ? String(r.descricao).trim() : '') || '',
            unidade: (r.unidade != null ? String(r.unidade).trim() : '') || ''
        }));
        return res.json(list);
    } catch (err) {
        console.error('Erro ao buscar produtos:', err);
        return res.status(500).json({ error: 'Erro ao buscar produtos no sistema.' });
    }
});

app.get('/detalhes/:chave', async (req, res) => {
    const { chave } = req.params;
    
    if (!/^\d{44}$/.test(chave)) {
        return res.status(400).json({ error: 'Informe uma chave com 44 dígitos.' });
    }

    if (!xml2js) {
        return res.status(503).json({ 
            error: 'Módulo xml2js não está instalado. Execute: npm install xml2js e reinicie o servidor.' 
        });
    }

    try {
        const [rows] = await pool.query(
            'SELECT XML FROM nfe_xml WHERE CHAVE = ? LIMIT 1',
            [chave]
        );
        
        if (!rows || rows.length === 0 || !rows[0]?.XML) {
            return res.status(404).json({ error: 'XML não encontrado no banco de dados para esta chave.' });
        }

        const xmlData = rows[0].XML;
        const parser = new xml2js.Parser({ 
            explicitArray: false, 
            mergeAttrs: true,
            ignoreAttrs: false,
            trim: true,
            explicitRoot: false
        });
        const resultado = await parser.parseStringPromise(xmlData);
        
        // Extrair informações da NF-e - tentar diferentes estruturas (XML padrão: nfeProc > NFe > infNFe)
        let nfe = {};
        if (resultado.nfeProc?.NFe?.infNFe) {
            nfe = resultado.nfeProc.NFe.infNFe;
        } else if (resultado.NFe?.infNFe) {
            nfe = resultado.NFe.infNFe;
        } else if (resultado.nfeProc?.infNFe) {
            nfe = resultado.nfeProc.infNFe;
        } else if (resultado.infNFe) {
            nfe = resultado.infNFe;
        } else if (resultado.nfeProc?.nfe?.infNFe) {
            nfe = resultado.nfeProc.nfe.infNFe;
        } else if (resultado.nfe?.infNFe) {
            nfe = resultado.nfe.infNFe;
        }
        
        const ide = nfe.ide || {};
        const emit = nfe.emit || {};
        const dest = nfe.dest || {};
        const total = nfe.total?.ICMSTot || nfe.total || {};
        const produtos = [];
        
        // Extrair produtos - pode estar como array ou objeto único
        let det = nfe.det || [];
        if (!Array.isArray(det)) {
            det = det ? [det] : [];
        }
        
        det.forEach((item, index) => {
            if (!item) return;
            
            const prod = item.prod || {};
            const imposto = item.imposto || {};
            
            // ICMS pode ter diferentes tipos (ICMS00, ICMS10, ICMS20, ICMS30, ICMS40, ICMS51, ICMS60, ICMS70, ICMS90, ICMS102, ICMS500)
            let icms = {};
            if (imposto.ICMS) {
                // Se ICMS é um array, pegar o primeiro elemento
                let icmsObj = Array.isArray(imposto.ICMS) ? imposto.ICMS[0] : imposto.ICMS;
                
                if (icmsObj && typeof icmsObj === 'object') {
                    // Tentar encontrar qualquer tipo de ICMS
                    const icmsTypes = ['ICMS00', 'ICMS10', 'ICMS20', 'ICMS30', 'ICMS40', 'ICMS41', 'ICMS50', 'ICMS51', 'ICMS60', 'ICMS70', 'ICMS90', 'ICMS102', 'ICMS500', 'ICMSPart', 'ICMSST', 'ICMSSN101', 'ICMSSN102', 'ICMSSN103', 'ICMSSN201', 'ICMSSN202', 'ICMSSN203', 'ICMSSN300', 'ICMSSN400', 'ICMSSN500', 'ICMSSN900'];
                    for (const type of icmsTypes) {
                        if (icmsObj[type]) {
                            const icmsData = Array.isArray(icmsObj[type]) ? icmsObj[type][0] : icmsObj[type];
                            if (icmsData && typeof icmsData === 'object') {
                                icms = icmsData;
                                break;
                            }
                        }
                    }
                    // Se não encontrou nenhum tipo específico, pegar o primeiro disponível
                    if (Object.keys(icms).length === 0) {
                        const icmsKeys = Object.keys(icmsObj).filter(key => 
                            icmsObj[key] && 
                            typeof icmsObj[key] === 'object' && 
                            !Array.isArray(icmsObj[key]) &&
                            (icmsObj[key].orig !== undefined || icmsObj[key].CST !== undefined || icmsObj[key].CSOSN !== undefined || icmsObj[key].csosn !== undefined || icmsObj[key].vBC !== undefined)
                        );
                        if (icmsKeys.length > 0) {
                            const firstKey = icmsKeys[0];
                            icms = icmsObj[firstKey];
                        } else {
                            // Última tentativa: pegar qualquer objeto que não seja array
                            const allKeys = Object.keys(icmsObj);
                            for (const key of allKeys) {
                                if (icmsObj[key] && typeof icmsObj[key] === 'object' && !Array.isArray(icmsObj[key])) {
                                    icms = icmsObj[key];
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            
            // (Debug ICMS removido - use DEBUG_FISCAL=1 para diagnóstico fiscal)
            
            // IPI pode ser IPITrib ou IPINT
            const ipi = imposto.IPI || {};
            const ipiTrib = ipi.IPITrib || {};
            const ipiNt = ipi.IPINT || {};
            
            // PIS pode ter diferentes tipos
            const pis = imposto.PIS || {};
            const pisAliq = pis.PISAliq || {};
            const pisQtde = pis.PISQtde || {};
            const pisSt = pis.PISST || {};
            const pisObj = pisAliq.cst ? pisAliq : (pisQtde.cst ? pisQtde : pisSt);
            
            // COFINS pode ter diferentes tipos
            const cofins = imposto.COFINS || {};
            const cofinsAliq = cofins.COFINSAliq || {};
            const cofinsQtde = cofins.COFINSQtde || {};
            const cofinsSt = cofins.COFINSST || {};
            const cofinsObj = cofinsAliq.cst ? cofinsAliq : (cofinsQtde.cst ? cofinsQtde : cofinsSt);
            
            // IBSCBS (Reforma tributária / IBS–CBS): cClassTrib no item
            let ibscbsNode = imposto.IBSCBS;
            if (Array.isArray(ibscbsNode)) ibscbsNode = ibscbsNode[0];
            ibscbsNode = ibscbsNode && typeof ibscbsNode === 'object' ? ibscbsNode : {};
            const cClassTribRaw = ibscbsNode.cClassTrib ?? ibscbsNode.CClassTrib ?? '';
            const cClassTribStr =
                cClassTribRaw !== null && cClassTribRaw !== undefined ? String(cClassTribRaw).trim() : '';
            
            produtos.push({
                item: index + 1,
                codigo: prod.cProd || '',
                ean: prod.cEAN || prod.cEANTrib || '',
                eanComercial: prod.cEAN || '',
                eanTributavel: prod.cEANTrib || '',
                descricao: prod.xProd || '',
                ncm: prod.NCM || '',
                cest: prod.CEST || '',
                indEscala: prod.indEscala || '',
                cfop: prod.CFOP || '',
                infAdProd: item.infAdProd || '',
                unidade: prod.uCom || '',
                quantidade: parseFloat(prod.qCom || prod.qTrib || 0),
                quantidadeTrib: parseFloat(prod.qTrib || prod.qCom || 0),
                valorUnitario: parseFloat(prod.vUnCom || prod.vUnTrib || 0),
                valorUnitarioTrib: parseFloat(prod.vUnTrib || prod.vUnCom || 0),
                valorTotal: parseFloat(prod.vProd || 0),
                valorFrete: parseFloat(prod.vFrete || 0),
                valorSeguro: parseFloat(prod.vSeg || 0),
                valorDesconto: parseFloat(prod.vDesc || 0),
                valorOutros: parseFloat(prod.vOutro || 0),
                unidadeTrib: prod.uTrib || prod.uCom || '',
                indTot: prod.indTot || '',
                xPed: prod.xPed || '',
                nItemPed: prod.nItemPed || '',
                // Detalhes ICMS
                icmsOrig: icms.orig || '',
                icmsCST: icms.CST || '',
                icmsCSOSN: icms.CSOSN || '',
                icmsModBC: icms.modBC || '',
                icmsRedBC: parseFloat(icms.pRedBC || 0),
                baseCalculoICMS: parseFloat(icms.vBC || 0),
                aliquotaICMS: parseFloat(icms.pICMS || 0),
                valorICMS: parseFloat(icms.vICMS || 0),
                // FCP (Fundo de Combate à Pobreza)
                baseCalculoFCP: parseFloat(icms.vBCFCP || 0),
                aliquotaFCP: parseFloat(icms.pFCP || 0),
                valorFCP: parseFloat(icms.vFCP || 0),
                // ICMS ST (Substituição Tributária)
                icmsModBCST: icms.modBCST || '',
                percentualMVA: parseFloat(icms.pMVAST || 0),
                baseCalculoICMSST: parseFloat(icms.vBCST || 0),
                aliquotaICMSST: parseFloat(icms.pICMSST || 0),
                valorICMSST: parseFloat(icms.vICMSST || 0),
                // FCP ST (Fundo de Combate à Pobreza - ST)
                baseCalculoFCPST: parseFloat(icms.vBCFCPST || 0),
                aliquotaFCPST: parseFloat(icms.pFCPST || 0),
                valorFCPST: parseFloat(icms.vFCPST || 0),
                // ICMS60 (ICMS cobrado anteriormente por substituição tributária)
                baseCalculoICMSSTRet: parseFloat(icms.vBCSTRet || 0),
                aliquotaICMSSTRet: parseFloat(icms.pST || 0),
                valorICMSSubstituto: parseFloat(icms.vICMSSubstituto || 0),
                valorICMSSTRet: parseFloat(icms.vICMSSTRet || 0),
                pCredSN: parseFloat(icms.pCredSN || 0),
                vCredICMSSN: parseFloat(icms.vCredICMSSN || 0),
                // Detalhes IPI
                ipiCEnq: ipi.cEnq || '',
                ipiCST: ipiTrib.CST || ipiNt.CST || '',
                baseCalculoIPI: parseFloat(ipiTrib.vBC || 0),
                aliquotaIPI: parseFloat(ipiTrib.pIPI || 0),
                valorIPI: parseFloat(ipiTrib.vIPI || ipiNt.vIPI || 0),
                // Detalhes PIS
                pisCST: pisObj.CST || '',
                baseCalculoPIS: parseFloat(pisObj.vBC || 0),
                aliquotaPIS: parseFloat(pisObj.pPIS || 0),
                valorPIS: parseFloat(pisObj.vPIS || 0),
                // Detalhes COFINS
                cofinsCST: cofinsObj.CST || '',
                baseCalculoCOFINS: parseFloat(cofinsObj.vBC || 0),
                aliquotaCOFINS: parseFloat(cofinsObj.pCOFINS || 0),
                valorCOFINS: parseFloat(cofinsObj.vCOFINS || 0),
                // IBS/CBS (XML)
                cClassTrib: cClassTribStr
            });
        });

        // Buscar dados do ERP na tabela itemcomp
        const cnpjEmitente = (emit.CNPJ || emit.CPF || '').replace(/\D/g, '').padStart(14, '0');
        const numeroNF = ide.nNF ? String(ide.nNF).trim() : '';
        const cnpjDestinatario = (dest.CNPJ || dest.CPF || '').replace(/\D/g, '').padStart(14, '0');
        const ufEmitente = String(emit.enderEmit?.UF || emit.enderEmit?.uf || emit.UF || emit.uf || '').trim().toUpperCase();
        const ufDestinatario = String(dest.enderDest?.UF || dest.enderDest?.uf || dest.UF || dest.uf || '').trim().toUpperCase();
        
        // Parear itens do ERP com produtos do XML por código (XML codigo = itemcomp.reffor)
        if (cnpjEmitente && numeroNF && cnpjDestinatario) {
            try {
                // Buscar itens do ERP - tentar com número como string e como número
                // Incluir JOIN com embalagem, produto e tabela para obter informações fiscais e NCM
                // Relação: itemcomp → embalagem → produto → tabela
                // itemcomp.NSU → embalagem.CODPRODUTO
                // embalagem.PRODUTO → produto.codigo
                // produto.fiscal → tabela.codigo
                const [itensRows] = await pool.query(
                    `SELECT itemcomp.DESCONTO AS ic_desconto,
                            itemcomp.ODA AS ic_oda,
                            itemcomp.*, 
                            produto.classificacao as produto_ncm,
                            produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                            tabela.codigo as tabela_codigo,
                            tabela.descricao as tabela_descricao,
                            fiscal.IMPOSTOS as fiscal_imposto,
                            fiscal_st.IMPOSTO as fiscal_imposto_st,
                            embalagem.BARRA1 as embalagem_barra1,
                            embalagem.BARRA2 as embalagem_barra2,
                            embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                            produto.CEST as produto_cest,
                            CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                            CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                            TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac
                     FROM itemcomp 
                     LEFT JOIN embalagem ON embalagem.CODPRODUTO = itemcomp.NSU
                     LEFT JOIN produto ON produto.codigo = embalagem.PRODUTO
                     LEFT JOIN tabela ON tabela.codigo = produto.fiscal
                     LEFT JOIN fornece ON fornece.CNPJ = itemcomp.fornece
                     LEFT JOIN estab ON estab.CNPJ = itemcomp.estab
                    LEFT JOIN fiscal ON fiscal.CODIGO = tabela.codigo 
                                     AND fiscal.UFORIGEM = fornece.UF 
                                     AND fiscal.UFDESTINO = estab.UF
                    LEFT JOIN fiscal fiscal_st ON fiscal_st.CODIGO = tabela.codigo
                                              AND fiscal_st.UFORIGEM = estab.UF
                                              AND fiscal_st.UFDESTINO = estab.UF
                     WHERE itemcomp.fornece = ? AND (itemcomp.numero = ? OR itemcomp.numero = CAST(? AS UNSIGNED)) AND itemcomp.estab = ?`,
                    [cnpjEmitente, numeroNF, numeroNF, cnpjDestinatario]
                );
                
                // Mapear itens do ERP por reffor (código de referência) para pareamento com XML
                // XML codigo (cProd) deve corresponder a itemcomp.reffor
                const poolPorReffor = {};
                const normalizar = (v) => String(v ?? '').trim();
                (itensRows || []).forEach((itemERP) => {
                    normalizarCamposItemcompParaFront(itemERP);
                    const reffor = itemERP.reffor ?? itemERP.REFFOR ?? '';
                    const key = normalizar(reffor);
                    if (!poolPorReffor[key]) poolPorReffor[key] = [];
                    poolPorReffor[key].push(itemERP);
                });
                
                // Parear cada produto do XML com item do ERP onde codigo (XML) = reffor (ERP)
                // Consome da pool para evitar duplicidade quando há itens repetidos
                produtos.forEach((produto) => {
                    const codigoNorm = normalizar(produto.codigo);
                    const lista = poolPorReffor[codigoNorm];
                    if (lista && lista.length > 0) {
                        produto.dadosERP = lista.shift();
                        produto.dadosERPOrigem = 'itemcomp';
                    } else {
                        produto.dadosERP = null;
                    }
                });
            } catch (erpError) {
                console.error('Erro ao buscar dados do ERP (itemcomp):', erpError);
                // Não falha a requisição se houver erro ao buscar dados do ERP
            }
        }

        // Fallback: buscar dados em tabfor quando NF ainda não está em itemcomp
        // TABFOR.FORNECE = fornecedor, TABFOR.CODFOR = cProd (código do XML), TABFOR.NSU = embalagem.CODPRODUTO
        if (cnpjEmitente) {
            const semDadosERP = produtos.filter((p) => !p.dadosERP);
            if (semDadosERP.length > 0) {
                // Incluir cProd original e sem zeros à esquerda (ex: "000001633" e "1633") para match com CODFOR
                const codigosParaTabfor = [...new Set(semDadosERP.flatMap((p) => {
                    const c = String(p.codigo ?? '').trim();
                    if (!c) return [];
                    const cSemZeros = c.replace(/^0+/, '') || '0';
                    return cSemZeros === c ? [c] : [c, cSemZeros];
                }))];
                if (codigosParaTabfor.length > 0) {
                    const placeholders = codigosParaTabfor.map(() => '?').join(', ');
                    const normalizar = (v) => String(v ?? '').trim();
                    let tabforRows = [];
                    // Vínculos: tabfor → embalagem → produto → tabela → fiscal (UFORIGEM, UFDESTINO)
                    // 1ª tentativa: fornece/estab para UFs; 2ª: UFs direto do XML (fallback quando fornece/estab não encontrados)
                    const temFiscal = (cnpjDestinatario && cnpjDestinatario.length > 0) || (ufEmitente && ufDestinatario);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B5',location:'server.js:1133',message:'Decisao tentativa fiscal tabfor',data:{cnpjEmitente,cnpjDestinatario,ufEmitente,ufDestinatario,temFiscal,codigosParaTabfor},timestamp:Date.now()})}).catch(()=>{});
                    // #endregion
                    const sqlTabforFiscal = `SELECT tabfor.CODFOR, tabfor.NSU,
                                        produto.classificacao as produto_ncm,
                                        produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                                        produto.CEST as produto_cest,
                                        produto.fiscal as produto_fiscal,
                                        tabela.codigo as tabela_codigo,
                                        tabela.descricao as tabela_descricao,
                                        embalagem.BARRA1 as embalagem_barra1,
                                        embalagem.BARRA2 as embalagem_barra2,
                                        embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                                        TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac,
                                        fiscal.REDUCAO as reducaos,
                                        fiscal.ATRIB2 as fiscal_atrib2,
                                        fiscal.IMPOSTOS as fiscal_imposto,
                                        fiscal.FCP_COMPRA_VAREJO as fcp_compra_varejo,
                                        fiscal_st.IMPOSTO as fiscal_imposto_st,
                                        fiscal.FCP_VENDA_VAREJO as fcp_venda_varejo,
                                        fiscal.REDUCAO as fiscal_st_reducao
                                 FROM sac.tabfor
                                 LEFT JOIN sac.embalagem ON embalagem.CODPRODUTO = tabfor.NSU
                                 LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
                                 LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
                                 LEFT JOIN sac.fiscal ON fiscal.CODIGO = tabela.codigo AND fiscal.UFORIGEM = ? AND fiscal.UFDESTINO = ?
                                 LEFT JOIN sac.fiscal fiscal_st ON fiscal_st.CODIGO = tabela.codigo AND fiscal_st.UFORIGEM = ? AND fiscal_st.UFDESTINO = ?
                                 WHERE tabfor.FORNECE = ? AND tabfor.CODFOR IN (${placeholders})`;
                    try {
                        if (temFiscal) {
                            let rows = [];
                            try {
                                const [r1] = await pool.query(
                                    `SELECT tabfor.CODFOR, tabfor.NSU,
                                        produto.classificacao as produto_ncm,
                                        produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                                        produto.CEST as produto_cest,
                                        produto.fiscal as produto_fiscal,
                                        tabela.codigo as tabela_codigo,
                                        tabela.descricao as tabela_descricao,
                                        embalagem.BARRA1 as embalagem_barra1,
                                        embalagem.BARRA2 as embalagem_barra2,
                                        embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                                        TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac,
                                        fiscal.REDUCAO as reducaos,
                                        fiscal.ATRIB2 as fiscal_atrib2,
                                        fiscal.IMPOSTOS as fiscal_imposto,
                                        fiscal.FCP_COMPRA_VAREJO as fcp_compra_varejo,
                                        fiscal_st.IMPOSTO as fiscal_imposto_st,
                                        fiscal.FCP_VENDA_VAREJO as fcp_venda_varejo,
                                        fiscal.REDUCAO as fiscal_st_reducao
                                 FROM sac.tabfor
                                 LEFT JOIN sac.embalagem ON embalagem.CODPRODUTO = tabfor.NSU
                                 LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
                                 LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
                                 LEFT JOIN sac.fornece ON fornece.CNPJ = ?
                                 LEFT JOIN sac.estab ON estab.CNPJ = ?
                                 LEFT JOIN sac.fiscal ON fiscal.CODIGO = tabela.codigo AND fiscal.UFORIGEM = COALESCE(fornece.UF, ?) AND fiscal.UFDESTINO = COALESCE(estab.UF, ?)
                                 LEFT JOIN sac.fiscal fiscal_st ON fiscal_st.CODIGO = tabela.codigo AND fiscal_st.UFORIGEM = COALESCE(estab.UF, ?) AND fiscal_st.UFDESTINO = COALESCE(estab.UF, ?)
                                 WHERE tabfor.FORNECE = ? AND tabfor.CODFOR IN (${placeholders})`,
                                    [cnpjEmitente, cnpjDestinatario || '', ufEmitente, ufDestinatario, ufDestinatario, ufDestinatario, cnpjEmitente, ...codigosParaTabfor]
                                );
                                rows = r1 || [];
                            } catch (e1) {
                                console.warn('Query tabfor com fornece/estab falhou:', e1.message);
                                // #region agent log
                                fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B6',location:'server.js:1192',message:'Falha query tabfor com fornece/estab',data:{error:e1.message},timestamp:Date.now()})}).catch(()=>{});
                                // #endregion
                            }
                            if (rows.length > 0) {
                                const temDadosFiscais = rows.some((r) => (r.fiscal_imposto ?? r.FISCAL_IMPOSTO ?? 0) || (r.reducaos ?? r.REDUCAOS ?? 0) || (r.fiscal_atrib2 ?? r.FISCAL_ATRIB2 ?? ''));
                                if (!temDadosFiscais && ufEmitente && ufDestinatario) {
                                    const [r2] = await pool.query(sqlTabforFiscal, [ufEmitente, ufDestinatario, ufDestinatario, ufDestinatario, cnpjEmitente, ...codigosParaTabfor]);
                                    if (r2 && r2.length > 0 && r2.some((r) => (r.fiscal_imposto ?? r.reducaos ?? r.fiscal_atrib2))) rows = r2;
                                }
                            } else if (ufEmitente && ufDestinatario) {
                                const [r2] = await pool.query(sqlTabforFiscal, [ufEmitente, ufDestinatario, ufDestinatario, ufDestinatario, cnpjEmitente, ...codigosParaTabfor]);
                                rows = r2 || [];
                            }
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B7',location:'server.js:1204',message:'Resultado final bloco fiscal tabfor',data:{rowCount:rows.length,temDadosFiscais:rows.some((r)=>(r.fiscal_imposto ?? r.FISCAL_IMPOSTO ?? 0) || (r.reducaos ?? r.REDUCAOS ?? 0) || (r.fiscal_atrib2 ?? r.FISCAL_ATRIB2 ?? '')),firstRow:rows[0]?{codfor:rows[0].CODFOR,produto_fiscal:rows[0].produto_fiscal,tabela_codigo:rows[0].tabela_codigo,fiscal_imposto:rows[0].fiscal_imposto,fiscal_atrib2:rows[0].fiscal_atrib2}:null},timestamp:Date.now()})}).catch(()=>{});
                            // #endregion
                            tabforRows = rows;
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B1',location:'server.js:1205',message:'Resultado query tabfor com fiscal',data:{ufEmitente,ufDestinatario,rowCount:rows.length,firstRow:rows[0]?{codfor:rows[0].CODFOR,produto_fiscal:rows[0].produto_fiscal,tabela_codigo:rows[0].tabela_codigo,tabela_descricao:rows[0].tabela_descricao,fiscal_imposto:rows[0].fiscal_imposto,fiscal_atrib2:rows[0].fiscal_atrib2,reducaos:rows[0].reducaos}:null},timestamp:Date.now()})}).catch(()=>{});
                            // #endregion
                        }
                    } catch (e) {
                        console.warn('Query tabfor com fiscal falhou, tentando query básica:', e.message);
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B8',location:'server.js:1208',message:'Falha bloco fiscal tabfor',data:{error:e.message},timestamp:Date.now()})}).catch(()=>{});
                        // #endregion
                    }
                    if (tabforRows.length === 0) {
                        try {
                            const [rows] = await pool.query(
                                `SELECT tabfor.CODFOR, tabfor.NSU,
                                        produto.classificacao as produto_ncm,
                                        produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                                        produto.CEST as produto_cest,
                                        produto.fiscal as produto_fiscal,
                                        tabela.codigo as tabela_codigo,
                                        tabela.descricao as tabela_descricao,
                                        embalagem.BARRA1 as embalagem_barra1,
                                        embalagem.BARRA2 as embalagem_barra2,
                                        embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                                        TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac
                                 FROM sac.tabfor
                                 LEFT JOIN sac.embalagem ON embalagem.CODPRODUTO = tabfor.NSU
                                 LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
                                 LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
                                 WHERE tabfor.FORNECE = ? AND tabfor.CODFOR IN (${placeholders})`,
                                [cnpjEmitente, ...codigosParaTabfor]
                            );
                            tabforRows = rows || [];
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B2',location:'server.js:1231',message:'Resultado query tabfor basica',data:{rowCount:tabforRows.length,firstRow:tabforRows[0]?{codfor:tabforRows[0].CODFOR,produto_fiscal:tabforRows[0].produto_fiscal,tabela_codigo:tabforRows[0].tabela_codigo,tabela_descricao:tabforRows[0].tabela_descricao}:null},timestamp:Date.now()})}).catch(()=>{});
                            // #endregion
                        } catch (tabforError) {
                            console.error('Erro ao buscar dados do ERP (tabfor):', tabforError);
                        }
                    }
                    const mapPorCodfor = {};
                    tabforRows.forEach((row) => {
                        const codfor = normalizar(row.CODFOR ?? row.codfor ?? '');
                        if (!mapPorCodfor[codfor]) mapPorCodfor[codfor] = row;
                        // Também indexar sem zeros à esquerda (cProd "000001633" vs CODFOR "1633")
                        const codforSemZeros = codfor.replace(/^0+/, '') || '0';
                        if (codforSemZeros !== codfor && !mapPorCodfor[codforSemZeros]) mapPorCodfor[codforSemZeros] = row;
                    });
                    produtos.forEach((produto) => {
                        if (!produto.dadosERP) {
                            const codigoNorm = normalizar(produto.codigo);
                            const codigoSemZeros = codigoNorm.replace(/^0+/, '') || '0';
                            const row = mapPorCodfor[codigoNorm] || mapPorCodfor[codigoSemZeros];
                            if (row) {
                                produto.dadosERP = row;
                                produto.dadosERPOrigem = 'tabfor';
                            }
                        }
                    });
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B3',location:'server.js:1250',message:'Produtos pareados com tabfor',data:{produtos:produtos.slice(0,4).map((p)=>({codigo:p.codigo,dadosERPOrigem:p.dadosERPOrigem||null,produto_fiscal:p.dadosERP?.produto_fiscal||null,tabela_codigo:p.dadosERP?.tabela_codigo||null,fiscal_imposto:p.dadosERP?.fiscal_imposto||null,fiscal_atrib2:p.dadosERP?.fiscal_atrib2||null}))},timestamp:Date.now()})}).catch(()=>{});
                    // #endregion
                }
            }
        }

        // Fallback: buscar por código de barras do XML em EMBALAGEM.BARRA1, BARRA2 ou BARRA3
        const aindaSemDadosERP = produtos.filter((p) => !p.dadosERP);
        if (aindaSemDadosERP.length > 0) {
            const normalizar = (v) => String(v ?? '').trim();
            const barrasParaBuscar = [];
            const excluirBarra = (b) => {
                const s = (b || '').toUpperCase();
                return !s || s === 'SEM GTIN' || s === 'SEM_GTIN';
            };
            aindaSemDadosERP.forEach((produto) => {
                const eanCom = normalizar(produto.eanComercial || '');
                const eanTrib = normalizar(produto.eanTributavel || '');
                const ean = normalizar(produto.ean || '');
                const barras = [eanCom, eanTrib, ean].filter((b) => b && !excluirBarra(b));
                barras.forEach((b) => barrasParaBuscar.push(b));
                // GTIN-14 (começa com 1): também tentar últimos 13 dígitos para match em embalagem
                barras.filter((b) => b.length === 14 && b.startsWith('1')).forEach((b) => barrasParaBuscar.push(b.slice(1)));
            });
            const barrasUnicas = [...new Set(barrasParaBuscar)];
            if (barrasUnicas.length > 0) {
                const placeholders = barrasUnicas.map(() => '?').join(', ');
                const temFiscal = (cnpjDestinatario && cnpjDestinatario.length > 0) || (ufEmitente && ufDestinatario);
                let embRows = [];
                try {
                    if (temFiscal) {
                        let rows = [];
                        try {
                            const [r1] = await pool.query(
                                `SELECT embalagem.CODPRODUTO AS NSU,
                                    produto.classificacao as produto_ncm,
                                    produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                                    produto.CEST as produto_cest,
                                    produto.fiscal as produto_fiscal,
                                    tabela.codigo as tabela_codigo,
                                    tabela.descricao as tabela_descricao,
                                    embalagem.BARRA1 as embalagem_barra1,
                                    embalagem.BARRA2 as embalagem_barra2,
                                    embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                                    CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                                    CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                                    TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac,
                                    fiscal.REDUCAO as reducaos,
                                        fiscal.ATRIB2 as fiscal_atrib2,
                                    fiscal.IMPOSTOS as fiscal_imposto,
                                    fiscal.FCP_COMPRA_VAREJO as fcp_compra_varejo,
                                    fiscal_st.IMPOSTO as fiscal_imposto_st,
                                    fiscal.FCP_VENDA_VAREJO as fcp_venda_varejo,
                                    fiscal.REDUCAO as fiscal_st_reducao
                             FROM sac.embalagem
                             LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
                             LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
                             LEFT JOIN sac.fornece ON fornece.CNPJ = ?
                             LEFT JOIN sac.estab ON estab.CNPJ = ?
                             LEFT JOIN sac.fiscal ON fiscal.CODIGO = tabela.codigo AND fiscal.UFORIGEM = COALESCE(fornece.UF, ?) AND fiscal.UFDESTINO = COALESCE(estab.UF, ?)
                             LEFT JOIN sac.fiscal fiscal_st ON fiscal_st.CODIGO = tabela.codigo AND fiscal_st.UFORIGEM = COALESCE(estab.UF, ?) AND fiscal_st.UFDESTINO = COALESCE(estab.UF, ?)
                             WHERE embalagem.BARRA1 IN (${placeholders}) OR embalagem.BARRA2 IN (${placeholders}) OR embalagem.BARRA3 IN (${placeholders})
                             LIMIT 500`,
                                [cnpjEmitente, cnpjDestinatario || '', ufEmitente, ufDestinatario, ufDestinatario, ufDestinatario, ...barrasUnicas, ...barrasUnicas, ...barrasUnicas]
                            );
                            rows = r1 || [];
                        } catch (e1) {
                            console.warn('Query embalagem com fornece/estab falhou:', e1.message);
                        }
                        if (rows.length > 0) {
                            const temDadosFiscais = rows.some((r) => (r.fiscal_imposto ?? r.FISCAL_IMPOSTO ?? 0) || (r.reducaos ?? r.REDUCAOS ?? 0) || (r.fiscal_atrib2 ?? r.FISCAL_ATRIB2 ?? ''));
                            if (!temDadosFiscais && ufEmitente && ufDestinatario) {
                                const [r2] = await pool.query(
                                    `SELECT embalagem.CODPRODUTO AS NSU,
                                        produto.classificacao as produto_ncm,
                                        produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                                        produto.CEST as produto_cest,
                                        produto.fiscal as produto_fiscal,
                                        embalagem.BARRA1 as embalagem_barra1,
                                        embalagem.BARRA2 as embalagem_barra2,
                                        embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                                        CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                                        TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac,
                                        fiscal.REDUCAO as reducaos,
                                        fiscal.ATRIB2 as fiscal_atrib2,
                                        fiscal.IMPOSTOS as fiscal_imposto,
                                        fiscal.FCP_COMPRA_VAREJO as fcp_compra_varejo,
                                        fiscal_st.IMPOSTO as fiscal_imposto_st,
                                        fiscal.FCP_VENDA_VAREJO as fcp_venda_varejo,
                                        fiscal.REDUCAO as fiscal_st_reducao
                                 FROM sac.embalagem
                                 LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
                                 LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
                                 LEFT JOIN sac.fiscal ON fiscal.CODIGO = tabela.codigo AND fiscal.UFORIGEM = ? AND fiscal.UFDESTINO = ?
                                 LEFT JOIN sac.fiscal fiscal_st ON fiscal_st.CODIGO = tabela.codigo AND fiscal_st.UFORIGEM = ? AND fiscal_st.UFDESTINO = ?
                                 WHERE embalagem.BARRA1 IN (${placeholders}) OR embalagem.BARRA2 IN (${placeholders}) OR embalagem.BARRA3 IN (${placeholders})
                                 LIMIT 500`,
                                    [ufEmitente, ufDestinatario, ufDestinatario, ufDestinatario, ...barrasUnicas, ...barrasUnicas, ...barrasUnicas]
                                );
                                if (r2 && r2.length > 0 && r2.some((r) => (r.fiscal_imposto ?? r.reducaos ?? r.fiscal_atrib2))) rows = r2;
                            }
                        } else if (ufEmitente && ufDestinatario) {
                            const [r2] = await pool.query(
                                `SELECT embalagem.CODPRODUTO AS NSU,
                                    produto.classificacao as produto_ncm,
                                    produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                                    produto.CEST as produto_cest,
                                    produto.fiscal as produto_fiscal,
                                    tabela.codigo as tabela_codigo,
                                    tabela.descricao as tabela_descricao,
                                    embalagem.BARRA1 as embalagem_barra1,
                                    embalagem.BARRA2 as embalagem_barra2,
                                    embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                                    CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                                    CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                                    TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac,
                                    fiscal.REDUCAO as reducaos,
                                        fiscal.ATRIB2 as fiscal_atrib2,
                                    fiscal.IMPOSTOS as fiscal_imposto,
                                    fiscal.FCP_COMPRA_VAREJO as fcp_compra_varejo,
                                    fiscal_st.IMPOSTO as fiscal_imposto_st,
                                    fiscal.FCP_VENDA_VAREJO as fcp_venda_varejo,
                                    fiscal.REDUCAO as fiscal_st_reducao
                             FROM sac.embalagem
                             LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
                             LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
                             LEFT JOIN sac.fiscal ON fiscal.CODIGO = tabela.codigo AND fiscal.UFORIGEM = ? AND fiscal.UFDESTINO = ?
                             LEFT JOIN sac.fiscal fiscal_st ON fiscal_st.CODIGO = tabela.codigo AND fiscal_st.UFORIGEM = ? AND fiscal_st.UFDESTINO = ?
                             WHERE embalagem.BARRA1 IN (${placeholders}) OR embalagem.BARRA2 IN (${placeholders}) OR embalagem.BARRA3 IN (${placeholders})
                             LIMIT 500`,
                                [ufEmitente, ufDestinatario, ufDestinatario, ufDestinatario, ...barrasUnicas, ...barrasUnicas, ...barrasUnicas]
                            );
                            rows = r2 || [];
                        }
                        embRows = rows;
                    }
                } catch (e) {
                    console.warn('Query embalagem com fiscal falhou, tentando query básica:', e.message);
                }
                if (embRows.length === 0) {
                    try {
                        const [rows] = await pool.query(
                            `SELECT embalagem.CODPRODUTO AS NSU,
                                    produto.classificacao as produto_ncm,
                                    produto.classificacao as produto_classificacao,
                                        produto.ATRIB as produto_atrib,
                                    produto.CEST as produto_cest,
                                    produto.fiscal as produto_fiscal,
                                    tabela.codigo as tabela_codigo,
                                    tabela.descricao as tabela_descricao,
                                    embalagem.BARRA1 as embalagem_barra1,
                                    embalagem.BARRA2 as embalagem_barra2,
                                    embalagem.BARRA3 as embalagem_barra3,
                            embalagem.NCM as embalagem_ncm,
                            embalagem.CEST as embalagem_cest,
                            embalagem.TRIB_CBS_IBS as embalagem_trib_cbs_ibs,
                                    CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), '-', calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu,
                                    CONCAT(COALESCE(embalagem.PLU, embalagem.CODPRODUTO), calculo_digito(COALESCE(embalagem.PLU, embalagem.CODPRODUTO))) as embalagem_plu_digito,
                                    TRIM(CONCAT(COALESCE(produto.DESCRICAO, produto.descricao, ''), ' ', COALESCE(embalagem.DESCRICAO, embalagem.descricao, ''))) as descricao_sac
                             FROM sac.embalagem
                             LEFT JOIN sac.produto ON produto.codigo = embalagem.PRODUTO
                             LEFT JOIN sac.tabela ON tabela.codigo = produto.fiscal
                             WHERE embalagem.BARRA1 IN (${placeholders}) OR embalagem.BARRA2 IN (${placeholders}) OR embalagem.BARRA3 IN (${placeholders})
                             LIMIT 500`,
                            [...barrasUnicas, ...barrasUnicas, ...barrasUnicas]
                        );
                        embRows = rows || [];
                    } catch (embError) {
                        console.error('Erro ao buscar dados do ERP (embalagem por barra):', embError);
                    }
                }
                const mapBarraParaRow = {};
                embRows.forEach((row) => {
                    const b1 = normalizar(row.embalagem_barra1 ?? row.EMBALAGEM_BARRA1 ?? '');
                    const b2 = normalizar(row.embalagem_barra2 ?? row.EMBALAGEM_BARRA2 ?? '');
                    const b3 = normalizar(row.embalagem_barra3 ?? row.EMBALAGEM_BARRA3 ?? '');
                    [b1, b2, b3].filter(Boolean).forEach((b) => {
                        if (!mapBarraParaRow[b]) mapBarraParaRow[b] = row;
                    });
                });
                aindaSemDadosERP.forEach((produto) => {
                    if (produto.dadosERP) return;
                    const eanCom = normalizar(produto.eanComercial || '');
                    const eanTrib = normalizar(produto.eanTributavel || '');
                    const ean = normalizar(produto.ean || '');
                    const ean13Com = (eanCom.length === 14 && eanCom.startsWith('1')) ? eanCom.slice(1) : '';
                    const ean13Trib = (eanTrib.length === 14 && eanTrib.startsWith('1')) ? eanTrib.slice(1) : '';
                    const ean13 = (ean.length === 14 && ean.startsWith('1')) ? ean.slice(1) : '';
                    const row = mapBarraParaRow[eanCom] || mapBarraParaRow[eanTrib] || mapBarraParaRow[ean]
                        || mapBarraParaRow[ean13Com] || mapBarraParaRow[ean13Trib] || mapBarraParaRow[ean13];
                    if (row) {
                        produto.dadosERP = row;
                        produto.dadosERPOrigem = 'embalagem';
                    }
                });
            }
        }

        // Calcular campos simulados para comparação quando NF não está no SAC (tabfor/embalagem)
        const enriquecerDadosERPFiscal = (produto) => {
            const origem = produto.dadosERPOrigem;
            if (origem !== 'tabfor' && origem !== 'embalagem') return;
            const erp = produto.dadosERP;
            if (!erp) return;
            const vUnTrib = parseFloat(produto.valorUnitarioTrib || produto.valorUnitario || 0);
            const qTrib = parseFloat(produto.quantidadeTrib || produto.quantidade || 0);
            const vOutro = parseFloat(produto.valorOutros || 0);
            const vIPI = parseFloat(produto.valorIPI || 0);
            const vFrete = parseFloat(produto.valorFrete || 0);
            const reducaos = parseFloat(erp.reducaos ?? erp.REDUCAOS ?? 0);
            const fiscalImposto = parseFloat(erp.fiscal_imposto ?? erp.FISCAL_IMPOSTO ?? erp.fiscal_impostos ?? erp.FISCAL_IMPOSTOS ?? 0) || 0;
            const fiscalImpostoST = parseFloat(erp.fiscal_imposto_st ?? erp.FISCAL_IMPOSTO_ST ?? 0);
            const fcpCompra = parseFloat(erp.fcp_compra_varejo ?? erp.FCP_COMPRA_VAREJO ?? 0);
            const fcpVenda = parseFloat(erp.fcp_venda_varejo ?? erp.FCP_VENDA_VAREJO ?? 0);
            const tributo = erp.fiscal_atrib2 ?? erp.FISCAL_ATRIB2 ?? erp.ATRIB2 ?? '';
            const cst = String(tributo).padStart(2, '0').slice(0, 2);
            const valorProduto = vUnTrib * qTrib;
            const adicionais = vOutro + vIPI + vFrete;
            const baseICMS = (cst === '30' || cst === '40' || cst === '60') ? 0
                : reducaos > 0 ? (valorProduto * (reducaos / 100)) + adicionais : valorProduto + adicionais;
            const valorICMS = baseICMS * (fiscalImposto / 100);
            const odaPerUnit = qTrib > 0 ? adicionais / qTrib : 0;
            const modalidadeBCST = String(produto.icmsModBCST || '').trim();
            const ehMVA = modalidadeBCST === '4' || modalidadeBCST === 4;
            const vBCST = parseFloat(produto.baseCalculoICMSST || 0);
            const pMVAST = parseFloat(produto.percentualMVA || 0);
            const reducaoST = parseFloat(erp.fiscal_st_reducao ?? erp.FISCAL_ST_REDUCAO ?? 0);
            let baseICMSST = ehMVA ? valorProduto * (1 + pMVAST / 100) : vBCST;
            if (cst === '70' && reducaoST > 0) baseICMSST = baseICMSST * (reducaoST / 100);
            const valorICMSST = ehMVA
                ? (baseICMSST * (fiscalImpostoST / 100)) - valorICMS
                : (vBCST * (fiscalImpostoST / 100)) - valorICMS;
            const valorFCP = baseICMS * (fcpCompra / 100);
            const valorFCPST = baseICMSST * (fcpVenda / 100);
            const tabelaCodigo = erp.tabela_codigo ?? erp.TABELA_CODIGO ?? erp.produto_fiscal ?? erp.PRODUTO_FISCAL ?? '';
            const tabelaDescricao = (erp.tabela_descricao ?? erp.TABELA_DESCRICAO ?? '').toString().trim();
            const embNcmFig = (erp.embalagem_ncm ?? erp.EMBALAGEM_NCM ?? '').toString().trim();
            const prodNcmFig = (erp.produto_classificacao ?? erp.PRODUTO_CLASSIFICACAO ?? erp.produto_ncm ?? erp.PRODUTO_NCM ?? '').toString().trim();
            const produtoNcm = embNcmFig || prodNcmFig;
            const partesFigura = [];
            if (tabelaCodigo && (tabelaDescricao || produtoNcm)) partesFigura.push(`${tabelaCodigo} - ${tabelaDescricao || produtoNcm}`);
            else if (tabelaCodigo) partesFigura.push(tabelaCodigo);
            else if (tabelaDescricao || produtoNcm) partesFigura.push(tabelaDescricao || produtoNcm);
            if (reducaos > 0) partesFigura.push(`RED ${reducaos.toFixed(2)}`);
            if (fiscalImposto > 0) partesFigura.push(`ALIQ: ${fiscalImposto}`);
            const figuraFiscal = partesFigura.length > 0 ? partesFigura.join(' ') : '';
            Object.assign(erp, {
                tributo, TRIBUTO: tributo, reffor: produto.codigo, REFFOR: produto.codigo,
                valor: vUnTrib, VALOR: vUnTrib, qtd: qTrib, QTD: qTrib, quantidade: qTrib, QUANTIDADE: qTrib,
                fator: 1, FATOR: 1,
                oda: odaPerUnit, ODA: odaPerUnit, reducao: reducaos > 0 ? reducaos : 0, REDUCAO: reducaos > 0 ? reducaos : 0,
                reducao_saida: reducaoST, REDUCAO_SAIDA: reducaoST,
                aliquota: fiscalImposto, ALIQUOTA: fiscalImposto,
                figura_fiscal: figuraFiscal, FIGURA_FISCAL: figuraFiscal,
                Pauta: vBCST, pauta: vBCST, imposto: Math.max(0, valorICMSST), IMPOSTO: Math.max(0, valorICMSST),
                FCP_aliquota: fcpCompra, FCP_ALIQUOTA: fcpCompra, fcp_valor: valorFCP, FCP_VALOR: valorFCP,
                fcpst_aliquota: fcpVenda, FCPST_ALIQUOTA: fcpVenda, fcpst_valor: valorFCPST, FCPST_VALOR: valorFCPST,
                ipi_valor: vIPI, IPI_VALOR: vIPI
            });
        };
        produtos.forEach(enriquecerDadosERPFiscal);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/81c96594-88d5-48b2-81ed-49528b70815c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'007759'},body:JSON.stringify({sessionId:'007759',runId:'pre-fix',hypothesisId:'B4',location:'server.js:1497',message:'Produtos apos enriquecimento fiscal',data:{produtos:produtos.filter((p)=>p.dadosERPOrigem==='tabfor'||p.dadosERPOrigem==='embalagem').slice(0,4).map((p)=>({codigo:p.codigo,origem:p.dadosERPOrigem,produto_fiscal:p.dadosERP?.produto_fiscal||null,tabela_codigo:p.dadosERP?.tabela_codigo||null,figura_fiscal:p.dadosERP?.figura_fiscal||null,aliquota:p.dadosERP?.aliquota??null,tributo:p.dadosERP?.tributo??null,fiscal_imposto:p.dadosERP?.fiscal_imposto??null,fiscal_atrib2:p.dadosERP?.fiscal_atrib2??null}))},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        // Figura Fiscal para itemcomp (NF lançada) - mesmo formato que tabfor/embalagem
        produtos.filter((p) => p.dadosERPOrigem === 'itemcomp' && p.dadosERP).forEach((produto) => {
            const erp = produto.dadosERP;
            const tabelaCodigo = erp.tabela_codigo ?? erp.TABELA_CODIGO ?? '';
            const tabelaDescricao = (erp.tabela_descricao ?? erp.TABELA_DESCRICAO ?? '').toString().trim();
            const embNcmFig = (erp.embalagem_ncm ?? erp.EMBALAGEM_NCM ?? '').toString().trim();
            const prodNcmFig = (erp.produto_classificacao ?? erp.PRODUTO_CLASSIFICACAO ?? erp.produto_ncm ?? erp.produto_NCM ?? '').toString().trim();
            const produtoNcm = embNcmFig || prodNcmFig;
            const reducao = parseFloat(erp.reducao ?? erp.REDUCAO ?? 0);
            const aliquota = parseFloat(erp.aliquota ?? erp.ALIQUOTA ?? erp.fiscal_imposto ?? erp.FISCAL_IMPOSTO ?? 0) || 0;
            const partesFigura = [];
            if (tabelaCodigo && (tabelaDescricao || produtoNcm)) partesFigura.push(`${tabelaCodigo} - ${tabelaDescricao || produtoNcm}`);
            else if (tabelaCodigo) partesFigura.push(tabelaCodigo);
            else if (tabelaDescricao || produtoNcm) partesFigura.push(tabelaDescricao || produtoNcm);
            if (reducao > 0) partesFigura.push(`RED ${reducao.toFixed(2)}`);
            if (aliquota > 0) partesFigura.push(`ALIQ: ${aliquota}`);
            const figuraFiscal = partesFigura.length > 0 ? partesFigura.join(' ') : '';
            if (figuraFiscal) Object.assign(erp, { figura_fiscal: figuraFiscal, FIGURA_FISCAL: figuraFiscal });
        });

        // Debug: log quando figura fiscal está vazia (tabfor/embalagem)
        if (process.env.DEBUG_FISCAL === '1') {
            produtos.filter((p) => (p.dadosERPOrigem === 'tabfor' || p.dadosERPOrigem === 'embalagem') && p.dadosERP).forEach((p, i) => {
                const erp = p.dadosERP;
                const temFiscal = (erp.fiscal_imposto ?? erp.FISCAL_IMPOSTO ?? 0) || (erp.reducaos ?? erp.REDUCAOS ?? 0) || (erp.fiscal_atrib2 ?? erp.FISCAL_ATRIB2 ?? '');
                if (!temFiscal && i < 3) {
                    console.log(`[DEBUG_FISCAL] Produto ${p.codigo} (${p.dadosERPOrigem}): fiscal_imposto=${erp.fiscal_imposto ?? erp.FISCAL_IMPOSTO}, reducaos=${erp.reducaos ?? erp.REDUCAOS}, atrib2=${erp.fiscal_atrib2 ?? erp.FISCAL_ATRIB2}, produto_fiscal=${erp.produto_fiscal}, tabela_codigo=${erp.tabela_codigo}`);
                }
            });
        }

        // Garantir que produtos sem pareamento tenham dadosERP = null e marcar "Cadastro não encontrado"
        produtos.forEach((produto) => {
            if (produto.dadosERP === undefined) produto.dadosERP = null;
            if (!produto.dadosERP) produto.cadastroNaoEncontrado = true;
        });

        // Buscar tolerâncias com prioridade
        let tolerancia = null;
        if (cnpjEmitente && cnpjDestinatario) {
            try {
                // Buscar todas as tolerâncias aplicáveis e ordenar por prioridade
                const [tolerancias] = await pool.query(`
                    SELECT *,
                        CASE 
                            WHEN CNPJ = ? AND FORNECEDOR = ? THEN 1
                            WHEN CNPJ = ? AND (FORNECEDOR = '' OR FORNECEDOR IS NULL) THEN 2
                            WHEN (CNPJ = '' OR CNPJ IS NULL) AND FORNECEDOR = ? THEN 3
                            WHEN (CNPJ = '' OR CNPJ IS NULL) AND (FORNECEDOR = '' OR FORNECEDOR IS NULL) THEN 4
                            ELSE 5
                        END AS prioridade
                    FROM tolera
                    WHERE 
                        (CNPJ = ? AND FORNECEDOR = ?) OR
                        (CNPJ = ? AND (FORNECEDOR = '' OR FORNECEDOR IS NULL)) OR
                        ((CNPJ = '' OR CNPJ IS NULL) AND FORNECEDOR = ?) OR
                        ((CNPJ = '' OR CNPJ IS NULL) AND (FORNECEDOR = '' OR FORNECEDOR IS NULL))
                    ORDER BY prioridade ASC
                    LIMIT 1
                `, [
                    cnpjDestinatario, cnpjEmitente,  // Prioridade 1
                    cnpjDestinatario,                // Prioridade 2
                    cnpjEmitente,                    // Prioridade 3
                    cnpjDestinatario, cnpjEmitente,  // WHERE condição 1
                    cnpjDestinatario,                // WHERE condição 2
                    cnpjEmitente                     // WHERE condição 3
                ]);
                
                if (tolerancias && tolerancias.length > 0) {
                    tolerancia = {
                        // Tolerâncias para ICMS/ICMS-ST/FCP/FCP-ST (e bases)
                        impMais: parseFloat(tolerancias[0].IMP2MA) || 0,
                        impMenos: parseFloat(tolerancias[0].IMP2ME) || 0,
                        // Tolerâncias para IPI
                        ipiMais: parseFloat(tolerancias[0].IPI2MA) || 0,
                        ipiMenos: parseFloat(tolerancias[0].IPI2ME) || 0,
                        // Informações adicionais da tolerância
                        prioridade: tolerancias[0].prioridade,
                        cnpj: tolerancias[0].CNPJ || '',
                        fornecedor: tolerancias[0].FORNECEDOR || ''
                    };
                    console.log('[DEBUG] Tolerância encontrada:', tolerancia);
                }
            } catch (toleranciaError) {
                console.error('Erro ao buscar tolerâncias:', toleranciaError);
            }
        }

        // Tentar obter CFOP e STATUS da compra (caso esteja no registro de compra em vez de item)
        let compraCFOP = null;
        let compraStatus = null;
        try {
            const [compRows] = await pool.query(
                'SELECT CFOP, STATUS FROM compra WHERE CHAVE_NFE = ? LIMIT 1',
                [chave]
            );
            if (compRows && compRows[0]) {
                compraCFOP = compRows[0].CFOP ? String(compRows[0].CFOP).trim() : null;
                compraStatus = compRows[0].STATUS !== null && compRows[0].STATUS !== undefined
                    ? String(compRows[0].STATUS).trim() : null;
            }
        } catch (compErr) {
            console.error('Erro ao buscar CFOP/STATUS da compra:', compErr);
            compraCFOP = null;
            compraStatus = null;
        }

        const dadosNfe = {
            chave: chave,
            numero: ide.nNF || '',
            serie: ide.serie || '',
            dataEmissao: ide.dhEmi || ide.dEmi || '',
            tipoOperacao: ide.tpNF || '',
            modelo: ide.mod || '',
            finalidade: ide.finNFe || '',
            naturezaOperacao: ide.natOp || '',
            emitente: {
                cnpj: emit.CNPJ || emit.CPF || '',
                nome: emit.xNome || '',
                fantasia: emit.xFant || '',
                endereco: {
                    logradouro: emit.enderEmit?.xLgr || '',
                    numero: emit.enderEmit?.nro || '',
                    complemento: emit.enderEmit?.xCpl || '',
                    bairro: emit.enderEmit?.xBairro || '',
                    municipio: emit.enderEmit?.xMun || '',
                    uf: emit.enderEmit?.UF || '',
                    cep: emit.enderEmit?.CEP || '',
                    telefone: emit.enderEmit?.fone || ''
                },
                ie: emit.IE || '',
                crt: emit.CRT || ''
            },
            destinatario: {
                cnpj: dest.CNPJ || dest.CPF || '',
                nome: dest.xNome || '',
                endereco: {
                    logradouro: dest.enderDest?.xLgr || '',
                    numero: dest.enderDest?.nro || '',
                    complemento: dest.enderDest?.xCpl || '',
                    bairro: dest.enderDest?.xBairro || '',
                    municipio: dest.enderDest?.xMun || '',
                    uf: dest.enderDest?.UF || '',
                    cep: dest.enderDest?.CEP || '',
                    telefone: dest.enderDest?.fone || ''
                },
                ie: dest.IE || ''
            },
            totais: {
                baseCalculoICMS: parseFloat(total.vBC || 0),
                valorICMS: parseFloat(total.vICMS || 0),
                baseCalculoICMSST: parseFloat(total.vBCST || 0),
                valorICMSST: parseFloat(total.vST || 0),
                valorTotalProdutos: parseFloat(total.vProd || 0),
                valorFrete: parseFloat(total.vFrete || 0),
                valorSeguro: parseFloat(total.vSeg || 0),
                valorDesconto: parseFloat(total.vDesc || 0),
                valorII: parseFloat(total.vII || 0),
                valorIPI: parseFloat(total.vIPI || 0),
                valorPIS: parseFloat(total.vPIS || 0),
                valorCOFINS: parseFloat(total.vCOFINS || 0),
                valorOutros: parseFloat(total.vOutro || 0),
                valorNF: parseFloat(total.vNF || 0)
            },
            tolerancia: tolerancia,
            produtos: produtos,
            compraCFOP: compraCFOP,
            compraStatus: compraStatus
        };

        res.json(dadosNfe);
    } catch (error) {
        console.error('Erro ao processar XML:', error);
        return res.status(500).json({ error: 'Falha ao processar XML da NF-e.' });
    }
});

// Rota para aplicar correção pontual de CST (Aplicar CST 60) em itemcomp
app.post('/itemcomp/aplicar-cst-60', async (req, res) => {
    try {
        const { nsu, fornece, numero, estab, item } = req.body || {};
        // Validar dados mínimos
        if (!nsu && !(fornece && numero && estab && item)) {
            return res.status(400).json({ error: 'Parâmetros insuficientes. Informe nsu ou (fornece, numero, estab, item).' });
        }

        const pautaValor = 0.00;
        const aliquotaValor = 0.00;
        const tributoValor = 60;

        let updateSql;
        let params = [];

        if (nsu) {
            updateSql = `UPDATE itemcomp SET PAUTA = ?, ALIQUOTA = ?, TRIBUTO = ? WHERE NSU = ? LIMIT 1`;
            params = [pautaValor, aliquotaValor, tributoValor, nsu];
        } else {
            // Atualizar com base em fornecedor, número, estabelecimento e item
            updateSql = `UPDATE itemcomp SET PAUTA = ?, ALIQUOTA = ?, TRIBUTO = ? WHERE fornece = ? AND (numero = ? OR numero = CAST(? AS UNSIGNED)) AND estab = ? AND (item = ? OR ITEM = ? OR nItem = ? OR NITEM = ? OR itemcomp = ? OR ITEMCOMP = ?) LIMIT 1`;
            params = [pautaValor, aliquotaValor, tributoValor, String(fornece || ''), String(numero || ''), String(numero || ''), String(estab || ''), String(item || ''), String(item || ''), String(item || ''), String(item || ''), String(item || ''), String(item || '')];
        }

        const [result] = await pool.query(updateSql, params);
        return res.json({ affectedRows: result.affectedRows || 0 });
    } catch (error) {
        console.error('Erro ao aplicar CST 60 em itemcomp:', error);
        return res.status(500).json({ error: 'Falha ao aplicar alteração em itemcomp.' });
    }
});
/**
 * Atualização em massa: aplica os mesmos valores em múltiplos registros de itemcomp.
 * Recebe payload: { chave, items: [ { fornece, numero, estab, item } ] }
 * Usa chave composta para limitar à NF selecionada. Não permite NF Recebida (STATUS = 4).
 */
app.post('/itemcomp/aplicar-cst-60-massa', async (req, res) => {
    const { chave, items } = req.body || {};
    const itemsArr = Array.isArray(items) ? items : null;
    if (!itemsArr || itemsArr.length === 0) {
        return res.status(400).json({ error: 'Nenhum item informado.' });
    }

    if (chave && /^\d{44}$/.test(chave)) {
        const [compRows] = await pool.query(
            'SELECT STATUS FROM compra WHERE CHAVE_NFE = ? LIMIT 1',
            [chave]
        );
        const status = compRows?.[0]?.STATUS;
        const statusNum = status !== null && status !== undefined ? parseInt(String(status), 10) : NaN;
        if (statusNum === 4) {
            return res.status(400).json({ error: 'Não é possível aplicar CST 60 em massa em notas com status "NF Recebida".' });
        }
    }

    const pautaValor = 0.00;
    const aliquotaValor = 0.00;
    const tributoValor = 60;
    const lucroValor = 0.00;
    const impostoValor = 0.00;
    const icmsValor = 0.00;
    const substitantValor = 0.00;

    let totalAffected = 0;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const it of itemsArr) {
            if (!it.fornece || !it.numero || it.estab === undefined || it.estab === null || it.item === undefined || it.item === null) {
                continue;
            }
            const updateSql = `UPDATE itemcomp SET PAUTA = ?, ALIQUOTA = ?, TRIBUTO = ?, LUCRO = ?, IMPOSTO = ?, ICMS = ?, SUBSTITANT = ? WHERE fornece = ? AND (numero = ? OR numero = CAST(? AS UNSIGNED)) AND estab = ? AND item = ?`;
            const params = [pautaValor, aliquotaValor, tributoValor, lucroValor, impostoValor, icmsValor, substitantValor, String(it.fornece), String(it.numero), String(it.numero), String(it.estab), String(it.item)];
            const [result] = await connection.query(updateSql, params);
            totalAffected += result?.affectedRows || 0;
        }

        await connection.commit();
        return res.json({ affectedRows: totalAffected });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Erro ao aplicar CST 60 em massa:', error);
        return res.status(500).json({ error: 'Falha ao aplicar alteração em massa.' });
    } finally {
        connection.release();
    }
});

/**
 * Atualização em massa: Simples Nacional (CSOSN no XML) em itemcomp.
 * Recebe payload: { chave, items: [ { fornece, numero, estab, item, comST?, lucro? } ] }
 * - comST true (CSOSN 201/202/203): TRIBUTO=30, LUCRO=MVA do XML (pMVAST), ALIQUOTA=0, demais zeros como na regra 41.
 * - comST false: TRIBUTO=41, LUCRO=0, ALIQUOTA=0 (regra anterior).
 * Usa chave composta para limitar à NF selecionada. Não permite NF Recebida (STATUS = 4).
 */
app.post('/itemcomp/aplicar-cst-41-massa', async (req, res) => {
    const { chave, items } = req.body || {};
    const itemsArr = Array.isArray(items) ? items : null;
    if (!itemsArr || itemsArr.length === 0) {
        return res.status(400).json({ error: 'Nenhum item informado.' });
    }

    if (chave && /^\d{44}$/.test(chave)) {
        const [compRows] = await pool.query(
            'SELECT STATUS FROM compra WHERE CHAVE_NFE = ? LIMIT 1',
            [chave]
        );
        const status = compRows?.[0]?.STATUS;
        const statusNum = status !== null && status !== undefined ? parseInt(String(status), 10) : NaN;
        if (statusNum === 4) {
            return res.status(400).json({ error: 'Não é possível aplicar CST 41 em massa em notas com status "NF Recebida".' });
        }
    }

    const pautaValor = 0.00;
    const aliquotaValor = 0.00;
    const impostoValor = 0.00;
    const icmsValor = 0.00;
    const substitantValor = 0.00;

    let totalAffected = 0;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const it of itemsArr) {
            if (!it.fornece || !it.numero || it.estab === undefined || it.estab === null || it.item === undefined || it.item === null) {
                continue;
            }
            const comST = it.comST === true || it.comST === 1 || it.comST === '1';
            const tributoValor = comST ? 30 : 41;
            let lucroValor = 0.00;
            if (comST) {
                const rawLucro = it.lucro !== undefined && it.lucro !== null ? it.lucro : it.pMVAST;
                const n = parseFloat(String(rawLucro).replace(',', '.'));
                lucroValor = Number.isFinite(n) ? n : 0;
            }
            const updateSql = `UPDATE itemcomp SET PAUTA = ?, ALIQUOTA = ?, TRIBUTO = ?, LUCRO = ?, IMPOSTO = ?, ICMS = ?, SUBSTITANT = ? WHERE fornece = ? AND (numero = ? OR numero = CAST(? AS UNSIGNED)) AND estab = ? AND item = ?`;
            const params = [pautaValor, aliquotaValor, tributoValor, lucroValor, impostoValor, icmsValor, substitantValor, String(it.fornece), String(it.numero), String(it.numero), String(it.estab), String(it.item)];
            const [result] = await connection.query(updateSql, params);
            totalAffected += result?.affectedRows || 0;
        }

        await connection.commit();
        return res.json({ affectedRows: totalAffected });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Erro ao aplicar CST 41 em massa:', error);
        return res.status(500).json({ error: 'Falha ao aplicar alteração em massa.' });
    } finally {
        connection.release();
    }
});

/**
 * Atualização em massa: aplica CST 20 do XML em itemcomp.
 * Recebe payload: { chave, items: [ { fornece, numero, estab, item, tributo, aliquota, reducao } ] }
 * Usa chave composta para limitar à NF selecionada. Não permite NF Recebida (STATUS = 4).
 */
app.post('/itemcomp/aplicar-cst-20-massa', async (req, res) => {
    const { chave, items } = req.body || {};
    const itemsArr = Array.isArray(items) ? items : null;
    if (!itemsArr || itemsArr.length === 0) {
        return res.status(400).json({ error: 'Nenhum item informado.' });
    }

    if (chave && /^\d{44}$/.test(chave)) {
        const [compRows] = await pool.query(
            'SELECT STATUS FROM compra WHERE CHAVE_NFE = ? LIMIT 1',
            [chave]
        );
        const status = compRows?.[0]?.STATUS;
        const statusNum = status !== null && status !== undefined ? parseInt(String(status), 10) : NaN;
        if (statusNum === 4) {
            return res.status(400).json({ error: 'Não é possível aplicar CST 20 em massa em notas com status "NF Recebida".' });
        }
    }

    let totalAffected = 0;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const it of itemsArr) {
            if (!it.fornece || !it.numero || it.estab === undefined || it.estab === null || it.item === undefined || it.item === null) {
                continue;
            }
            const tributoValor = parseInt(String(it.tributo ?? 20), 10) || 20;
            const aliquotaValor = parseFloat(it.aliquota ?? 0) || 0;
            const reducaoValor = parseFloat(it.reducao ?? 0) || 0;

            const updateSql = `UPDATE itemcomp SET ALIQUOTA = ?, TRIBUTO = ?, REDUCAO = ? WHERE fornece = ? AND (numero = ? OR numero = CAST(? AS UNSIGNED)) AND estab = ? AND item = ?`;
            const params = [aliquotaValor, tributoValor, reducaoValor, String(it.fornece), String(it.numero), String(it.numero), String(it.estab), String(it.item)];
            const [result] = await connection.query(updateSql, params);
            totalAffected += result?.affectedRows || 0;
        }

        await connection.commit();
        return res.json({ affectedRows: totalAffected });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Erro ao aplicar CST 20 em massa:', error);
        return res.status(500).json({ error: 'Falha ao aplicar CST 20 em massa.' });
    } finally {
        connection.release();
    }
});

/**
 * Atualização em massa: zera PAUTA e LUCRO em itemcomp para itens com CST 10/70 e Base ST + Valor ICMS ST zerados no XML.
 * Recebe payload: { chave, items: [ { fornece, numero, estab, item } ] }
 * Usa chave composta (fornece, numero, estab, item) para limitar à NF atual — nunca NSU sozinho.
 * Não permite update em notas com status "NF Recebida" (STATUS = 4).
 */
app.post('/itemcomp/aplicar-st-zerado-massa', async (req, res) => {
    const { chave, items } = req.body || {};
    const itemsArr = Array.isArray(items) ? items : null;
    if (!itemsArr || itemsArr.length === 0) {
        return res.status(400).json({ error: 'Nenhum item informado.' });
    }

    if (chave && /^\d{44}$/.test(chave)) {
        const [compRows] = await pool.query(
            'SELECT STATUS FROM compra WHERE CHAVE_NFE = ? LIMIT 1',
            [chave]
        );
        const status = compRows?.[0]?.STATUS;
        const statusNum = status !== null && status !== undefined ? parseInt(String(status), 10) : NaN;
        if (statusNum === 4) {
            return res.status(400).json({ error: 'Não é possível aplicar em notas com status "NF Recebida".' });
        }
    }

    let totalAffected = 0;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const it of itemsArr) {
            if (!it.fornece || !it.numero || it.estab === undefined || it.estab === null || it.item === undefined || it.item === null) {
                continue;
            }
            const updateSql = `UPDATE itemcomp SET PAUTA = 0, LUCRO = 0 WHERE fornece = ? AND (numero = ? OR numero = CAST(? AS UNSIGNED)) AND estab = ? AND item = ?`;
            const params = [String(it.fornece), String(it.numero), String(it.numero), String(it.estab), String(it.item)];
            const [result] = await connection.query(updateSql, params);
            totalAffected += result?.affectedRows || 0;
        }

        await connection.commit();
        return res.json({ affectedRows: totalAffected });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Erro ao aplicar ST zerado em massa:', error);
        const msg = error && error.message ? error.message : 'Erro desconhecido';
        return res.status(500).json({
            error: 'Falha ao aplicar PAUTA/LUCRO zerados em massa.',
            detalhe: msg
        });
    } finally {
        connection.release();
    }
});

/**
 * Atualização em massa: XML com modalidade BC ST = Pauta (modBCST=5) e SAC com MVA (LUCRO).
 * Zera LUCRO e grava a pauta do XML em itemcomp.PAUTA.
 * Recebe payload: { chave, items: [ { fornece, numero, estab, item, pauta } ] }
 * Usa chave composta para limitar à NF selecionada. Não permite NF Recebida (STATUS = 4).
 */
app.post('/itemcomp/aplicar-pauta-xml-massa', async (req, res) => {
    const { chave, items } = req.body || {};
    const itemsArr = Array.isArray(items) ? items : null;
    if (!itemsArr || itemsArr.length === 0) {
        return res.status(400).json({ error: 'Nenhum item informado.' });
    }

    if (chave && /^\d{44}$/.test(chave)) {
        const [compRows] = await pool.query(
            'SELECT STATUS FROM compra WHERE CHAVE_NFE = ? LIMIT 1',
            [chave]
        );
        const status = compRows?.[0]?.STATUS;
        const statusNum = status !== null && status !== undefined ? parseInt(String(status), 10) : NaN;
        if (statusNum === 4) {
            return res.status(400).json({ error: 'Não é possível aplicar pauta do XML em notas com status "NF Recebida".' });
        }
    }

    let totalAffected = 0;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const it of itemsArr) {
            if (!it.fornece || !it.numero || it.estab === undefined || it.estab === null || it.item === undefined || it.item === null) {
                continue;
            }
            const pautaValor = parseFloat(it.pauta);
            if (!Number.isFinite(pautaValor) || pautaValor < 0) continue;

            const updateSql = `UPDATE itemcomp SET LUCRO = 0, PAUTA = ? WHERE fornece = ? AND (numero = ? OR numero = CAST(? AS UNSIGNED)) AND estab = ? AND item = ?`;
            const params = [
                Number(pautaValor.toFixed(4)),
                String(it.fornece),
                String(it.numero),
                String(it.numero),
                String(it.estab),
                String(it.item)
            ];
            const [result] = await connection.query(updateSql, params);
            totalAffected += result?.affectedRows || 0;
        }

        await connection.commit();
        return res.json({ affectedRows: totalAffected });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Erro ao aplicar pauta XML em massa:', error);
        const msg = error && error.message ? error.message : 'Erro desconhecido';
        return res.status(500).json({
            error: 'Falha ao aplicar pauta do XML em massa.',
            detalhe: msg
        });
    } finally {
        connection.release();
    }
});

/**
 * Atualização em massa: aplica valor de Frete+Outros do XML em itemcomp.ODA.
 * ODA = (valorFrete + valorOutros) / qtd para cada item.
 * Recebe payload: { chave, items: [ { fornece, numero, estab, item, oda } ] }
 * Usa chave composta para limitar à NF selecionada. Não permite NF Recebida (STATUS = 4).
 */
app.post('/itemcomp/aplicar-oda-frete', async (req, res) => {
    const { chave, items } = req.body || {};
    const itemsArr = Array.isArray(items) ? items : null;
    if (!itemsArr || itemsArr.length === 0) {
        return res.status(400).json({ error: 'Nenhum item informado.' });
    }

    if (chave && /^\d{44}$/.test(chave)) {
        const [compRows] = await pool.query(
            'SELECT STATUS FROM compra WHERE CHAVE_NFE = ? LIMIT 1',
            [chave]
        );
        const status = compRows?.[0]?.STATUS;
        const statusNum = status !== null && status !== undefined ? parseInt(String(status), 10) : NaN;
        if (statusNum === 4) {
            return res.status(400).json({ error: 'Não é possível aplicar frete em ODA em notas com status "NF Recebida".' });
        }
    }

    let totalAffected = 0;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const it of itemsArr) {
            if (!it.fornece || !it.numero || it.estab === undefined || it.estab === null || it.item === undefined || it.item === null) {
                continue;
            }
            const odaValor = parseFloat(it.oda);
            if (isNaN(odaValor) || odaValor < 0) continue;

            const updateSql = `UPDATE itemcomp SET ODA = ? WHERE fornece = ? AND (numero = ? OR numero = CAST(? AS UNSIGNED)) AND estab = ? AND item = ?`;
            const params = [odaValor.toFixed(4), String(it.fornece), String(it.numero), String(it.numero), String(it.estab), String(it.item)];
            const [result] = await connection.query(updateSql, params);
            totalAffected += result?.affectedRows || 0;
        }

        await connection.commit();
        return res.json({ affectedRows: totalAffected });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Erro ao aplicar ODA/Frete em massa:', error);
        return res.status(500).json({ error: 'Falha ao aplicar ODA em massa.' });
    } finally {
        connection.release();
    }
});

app.get('/detalhes.html', (req, res) => res.sendFile(path.join(__dirname, 'detalhes.html')));
app.get('/manutencao.html', (req, res) => res.sendFile(path.join(__dirname, 'manutencao.html')));
app.get('/autorizacao-recepcao-xml.html', (req, res) => res.sendFile(path.join(__dirname, 'autorizacao-recepcao-xml.html')));
app.get('/confnf.html', (req, res) => res.sendFile(path.join(__dirname, 'confnf.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/admin/versao', (req, res) => {
    const versao = updater ? updater.lerVersaoLocal() : 'desconhecida';
    res.json({ versao, node: process.version, plataforma: process.platform });
});

/**
 * Status leve usado pela UI (badge "atualização disponível").
 * Não baixa nada e não exige token; só compara local x release pública.
 */
app.get('/admin/verificar-atualizacao', async (req, res) => {
    if (!updater) {
        return res.status(503).json({ error: 'Modulo updater nao disponivel.' });
    }
    try {
        const status = await updater.consultarStatus();
        res.json(status);
    } catch (e) {
        console.error('[ADMIN] Erro no /admin/verificar-atualizacao:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * Reconhece IPs "internos" considerados confiáveis para acionar atualização sem token:
 *  - Loopback (127.x, ::1)
 *  - LAN privada: 10/8, 172.16/12, 192.168/16
 *  - Link-local: 169.254/16, fe80::/10
 * Em ambiente desktop o servidor roda na rede local da empresa, então é seguro
 * permitir que a UI dispare update sem o token. Para fechar isso, defina
 * UPDATE_REQUIRE_TOKEN=true no .env — passa a exigir token de qualquer origem.
 */
function ipOrigem(req) {
    let ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    return String(ip).replace(/^::ffff:/, '');
}
function vemDeRedeInterna(req) {
    const ip = ipOrigem(req);
    if (!ip) return false;
    if (ip === '::1' || ip === 'localhost') return true;
    if (/^127\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true;
    if (/^fe80:/i.test(ip)) return true;
    return false;
}

app.post('/admin/atualizar', async (req, res) => {
    if (!updater) {
        return res.status(503).json({ error: 'Modulo updater nao disponivel.' });
    }
    const exigirToken = String(process.env.UPDATE_REQUIRE_TOKEN || '').toLowerCase() === 'true';
    const token = req.get('X-Update-Token') || req.query.token;
    const autorizadoToken = !!UPDATE_TOKEN_ADMIN && token === UPDATE_TOKEN_ADMIN;
    const autorizadoLocal = !exigirToken && vemDeRedeInterna(req);
    if (!autorizadoToken && !autorizadoLocal) {
        const ipDetectado = ipOrigem(req);
        console.warn(`[ADMIN] /admin/atualizar bloqueado. IP origem=${ipDetectado} exigirToken=${exigirToken} tokenPresente=${!!token}`);
        if (!UPDATE_TOKEN_ADMIN) {
            return res.status(503).json({
                error: 'UPDATE_ADMIN_TOKEN nao configurado no .env (necessário para chamadas remotas).',
                ipOrigem: ipDetectado
            });
        }
        return res.status(401).json({ error: 'Token invalido.', ipOrigem: ipDetectado });
    }
    try {
        const forcar = String(req.query.force || req.body?.force || '').toLowerCase() === 'true';
        const r = await updater.verificarEAtualizar({ forcar });
        res.json(r);
        if (r.atualizado) {
            updater.reiniciarProcesso();
        }
    } catch (e) {
        console.error('[ADMIN] Erro no /admin/atualizar:', e);
        res.status(500).json({ error: e.message });
    }
});

// Middleware estático deve vir depois das rotas de API
app.use(express.static(__dirname));

// Iniciar servidor e testar conexão
async function iniciarServidor() {
    console.log('\n==================================================');
    console.log('  Consulta NF-e :: Iniciando Servidor');
    console.log('==================================================\n');
    if (updater) {
        console.log(`[INFO] Versao instalada: ${updater.lerVersaoLocal()}`);
    }
    console.log(`[INFO] Iniciando servidor na porta ${PORT}...`);
    console.log('[INFO] Pressione Ctrl+C para parar o servidor\n');

    if (updater) {
        try {
            const atualizou = await updater.executarNoBoot();
            if (atualizou) {
                updater.reiniciarProcesso();
                return;
            }
        } catch (e) {
            console.error('[UPDATER] Falha na verificacao inicial:', e.message);
        }
        const intervalo = Number(process.env.UPDATE_INTERVAL_H) || 6;
        updater.agendarVerificacoes(intervalo);
        console.log(`[INFO] Verificacao de atualizacao a cada ${intervalo}h.`);
    }

    // Testar conexão com o banco antes de iniciar o servidor
    const conexaoOk = await testarConexao();
    
    if (!conexaoOk) {
        console.error('\n[ERRO] Não foi possível conectar ao banco de dados.');
        console.error('[ERRO] O servidor não será iniciado até que o problema seja resolvido.\n');
        process.exit(1);
    }
    
    app.listen(PORT, () => {
        console.log(`\n[INFO] Servidor rodando em http://localhost:${PORT}\n`);
    });
}

iniciarServidor();
