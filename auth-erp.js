const crypto = require('crypto');
const path = require('path');
const jwt = require('jsonwebtoken');

const COOKIE = 'lumi_nfe';
const R = [0, 113, 120, 6, 181, 121, 63, 208, 87, 65];
const EB = new Map([
    [0x30, 0x41], [0x31, 0xcb], [0x32, 0x82], [0x33, 0xe9], [0x34, 0xad],
    [0x35, 0xce], [0x36, 0x5f], [0x37, 0xf1], [0x38, 0x0c], [0x39, 0x91],
    [0x20, 0xc5], [0x40, 0x24], [0x46, 0xa1], [0x4a, 0xd1], [0x61, 0x86],
    [0x6c, 0x96], [0x6e, 0xf5], [0x6f, 0x71], [0x73, 0xb1], [0x75, 0x3c],
]);

function onlyDigits(v) {
    return String(v || '').replace(/\D/g, '');
}

function normalizeMatriculaInput(raw) {
    const digits = onlyDigits(raw);
    const withDvInput = digits.padStart(7, '0').slice(-7);
    return { digits, withDvInput, base: withDvInput.slice(0, 6) };
}

function senhaToBuffer(senha) {
    if (senha == null) return null;
    if (Buffer.isBuffer(senha)) return senha;
    const s = String(senha);
    if (!s) return null;
    return Buffer.from(s, 'binary');
}

function invHas(e, pi, table) {
    for (const [ch, val] of table) {
        if (val === e && ch !== pi) return true;
    }
    return false;
}

function encodeSoftlumiPassword(plain) {
    if (!plain || plain.length > 10) return null;
    const padded = plain.padEnd(10, ' ');
    const out = Buffer.alloc(10);
    let shift = 0;
    for (let i = 0; i < 10; i++) {
        const pi = padded.charCodeAt(i);
        const e = EB.get(pi);
        if (e === undefined) return null;
        const tmp = shift ^ R[i];
        out[i] = (e ^ tmp) & 0xff;
        shift = (tmp ^ pi) & 0xff;
    }
    return out;
}

function softlumiPasswordMatches(plain, stored) {
    if (stored == null || !plain || plain.length > 10) return false;
    const got = typeof stored === 'string' ? Buffer.from(stored, 'binary') : Buffer.from(stored);
    if (got.length !== 10) return false;
    const padded = plain.padEnd(10, ' ');
    const tentative = new Map(EB);
    let knownAnchor = false;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
        const pi = padded.charCodeAt(i);
        const tmp = (shift ^ R[i]) & 0xff;
        const requiredE = (got[i] ^ tmp) & 0xff;
        if (EB.has(pi)) {
            knownAnchor = true;
            if (EB.get(pi) !== requiredE) return false;
        } else if (tentative.has(pi)) {
            if (tentative.get(pi) !== requiredE) return false;
        } else {
            if (invHas(requiredE, pi, tentative)) return false;
            tentative.set(pi, requiredE);
        }
        shift = (tmp ^ pi) & 0xff;
    }
    if (!knownAnchor && plain.length >= 10) return false;
    for (const [k, v] of tentative) {
        if (!EB.has(k)) EB.set(k, v);
    }
    return true;
}

function pularLogin() {
    const v = String(process.env.NFE_PULAR_LOGIN || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'sim' || v === 'yes';
}

function usuarioPularLogin(obterServidor) {
    const padrao = typeof obterServidor === 'function' ? obterServidor(null) : null;
    return {
        matricula: '',
        nome: 'Acesso local',
        cnpj: '',
        fantasia: '',
        admin: true,
        todasLojas: true,
        serverId: padrao ? padrao.id : '',
        pularLogin: true,
    };
}

function jwtSecret() {
    return process.env.AUTH_JWT_SECRET || process.env.CONFNF_JWT_SECRET || 'lumi-nfe-auth';
}

function sessionHours() {
    const n = Number(process.env.AUTH_SESSION_HOURS || process.env.CONFNF_SESSION_HOURS || 8);
    return Number.isFinite(n) && n > 0 ? n : 8;
}

function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

function setSessionCookie(res, token, hours) {
    res.setHeader(
        'Set-Cookie',
        `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.round(hours * 3600)}`
    );
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function lerUsuario(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token) return null;
    try {
        return jwt.verify(token, jwtSecret());
    } catch (_e) {
        return null;
    }
}

function estaDesligado(valor) {
    const s = String(valor ?? '').trim();
    if (!s || s === 'N' || s === '0') return false;
    return /^\d{8}$/.test(s);
}

function isAdminAcesso(acesso) {
    return String(acesso || '').trim().toUpperCase().startsWith('S');
}

function escolheuTodasLojas(raw) {
    const v = String(raw || '').trim().toUpperCase();
    return v === 'ALL' || v === 'ADMIN' || v === 'ADMINISTRATIVO';
}

function cnpjDaSessao(req) {
    const u = req && req.usuario;
    if (!u) return { todasLojas: false, cnpj: '' };
    if (u.todasLojas) return { todasLojas: true, cnpj: '' };
    return { todasLojas: false, cnpj: onlyDigits(u.cnpj) };
}

function cnpjEfetivo(req, pedido) {
    const escopo = cnpjDaSessao(req);
    const pedidoNorm = onlyDigits(pedido);
    if (escopo.todasLojas) return pedidoNorm;
    if (escopo.cnpj) return escopo.cnpj;
    return pedidoNorm;
}

function matriculasAlteracao() {
    return String(process.env.NFE_ALTERAR_MATRICULAS || '')
        .split(/[,;|]/)
        .map((s) => onlyDigits(s))
        .filter(Boolean);
}

function variantesMatricula(raw) {
    const d = onlyDigits(raw);
    if (!d) return new Set();
    const semZero = d.replace(/^0+/, '') || '0';
    const out = new Set([d, semZero, d.padStart(6, '0'), d.padStart(7, '0')]);
    if (d.length >= 7) {
        const base = d.slice(0, -1);
        out.add(base);
        out.add(base.replace(/^0+/, '') || '0');
        out.add(base.padStart(6, '0'));
    }
    return out;
}

function podeAlterarNfe(usuario) {
    const lista = matriculasAlteracao();
    if (!lista.length) return true;
    const userVars = variantesMatricula(usuario && usuario.matricula);
    if (!userVars.size) return false;
    return lista.some((cod) => {
        for (const v of variantesMatricula(cod)) {
            if (userVars.has(v)) return true;
        }
        return false;
    });
}

async function buscarFuncionario(pool, matriculaRaw) {
    const { digits, withDvInput } = normalizeMatriculaInput(matriculaRaw);
    if (!digits) return null;
    const [rows] = await pool.query(
        `SELECT
            TRIM(f.MATRICULA) AS MATRICULA_BASE,
            CONCAT(TRIM(f.MATRICULA), calculo_digito(f.MATRICULA)) AS MATRICULA_DV,
            f.NOME, f.APELIDO, f.CNPJ, f.DESLIGADO, f.ACESSO
         FROM funciona f
         WHERE (
             CAST(CONCAT(TRIM(f.MATRICULA), calculo_digito(f.MATRICULA)) AS UNSIGNED) = CAST(? AS UNSIGNED)
             OR CONCAT(TRIM(f.MATRICULA), calculo_digito(f.MATRICULA)) = ?
             OR CAST(TRIM(f.MATRICULA) AS UNSIGNED) = CAST(? AS UNSIGNED)
             OR LPAD(TRIM(f.MATRICULA), 6, '0') = ?
           )
           AND NOT (TRIM(IFNULL(f.DESLIGADO, '')) REGEXP '^[0-9]{8}$')
         ORDER BY
           CASE WHEN CONCAT(TRIM(f.MATRICULA), calculo_digito(f.MATRICULA)) = ? THEN 0 ELSE 1 END
         LIMIT 1`,
        [digits, withDvInput, digits, withDvInput.slice(0, 6), withDvInput]
    );
    const func = rows && rows[0];
    if (!func || estaDesligado(func.DESLIGADO)) return null;
    return func;
}

async function listarEstabelecimentos(pool) {
    const [rows] = await pool.query(
        `SELECT CNPJ AS cnpj, COALESCE(NULLIF(TRIM(FANTASIA), ''), NULLIF(TRIM(RAZAO), ''), CNPJ) AS nome
         FROM ESTAB
         WHERE CNPJ IS NOT NULL AND TRIM(CNPJ) <> ''
         ORDER BY nome ASC`
    );
    return (rows || []).map((r) => ({
        cnpj: onlyDigits(r.cnpj || r.CNPJ),
        nome: r.nome || r.NOME || onlyDigits(r.cnpj || r.CNPJ),
    })).filter((r) => r.cnpj.length === 14);
}

function pathRequisicao(req) {
    let bruto = String(req.originalUrl || req.url || req.path || '').split('?')[0];
    if (!bruto) return '/';
    if (!bruto.startsWith('/')) bruto = `/${bruto}`;
    if (bruto.length > 1 && bruto.endsWith('/')) bruto = bruto.slice(0, -1);
    return bruto;
}

function caminhoPublico(req) {
    const p = pathRequisicao(req);
    if (p === '/login.html' || p === '/logo-lumi.png' || p === '/favicon.ico' || p === '/favicon.png') return true;
    if (req.method === 'GET' && p === '/api/auth/estabelecimentos') return true;
    if (req.method === 'GET' && p === '/api/auth/usuario') return true;
    if (req.method === 'GET' && p === '/api/auth/servidores') return true;
    if (req.method === 'GET' && p === '/api/auth/me') return true;
    if (req.method === 'POST' && p === '/api/auth/login') return true;
    if (req.method === 'POST' && p === '/api/auth/logout') return true;
    if (req.method === 'GET' && p === '/admin/verificar-atualizacao') return true;
    if (req.method === 'POST' && p === '/admin/atualizar') return true;
    return false;
}

function querHtml(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const p = pathRequisicao(req);
    if (p === '/' || p.endsWith('.html')) return true;
    return String(req.headers.accept || '').includes('text/html');
}

async function senhaConfereNaLinhaFunciona(pool, row, opts) {
    const { matriculaBase, matriculaComDv, cnpj, plain } = opts;
    if (!row || !plain) return false;
    const cnpjLinha = onlyDigits(row.CNPJ || cnpj);

    const senhaRaw = row.SENHA;
    const senhaBuf = senhaToBuffer(senhaRaw);
    if (senhaBuf && senhaBuf.length === 10) {
        if (softlumiPasswordMatches(plain, senhaBuf)) return true;
    }
    const senhaTxt = senhaRaw != null ? String(senhaRaw).trim() : '';
    if (/^[0-9A-Fa-f]{20}$/.test(senhaTxt)) {
        if (softlumiPasswordMatches(plain, Buffer.from(senhaTxt, 'hex'))) return true;
    }

    const md5 = String(row.MD5_PANAMAH || '').trim().toUpperCase();
    if (md5 && md5 !== 'D41D8CD98F00B204E9800998ECF8427E') {
        const dig = crypto.createHash('md5').update(plain, 'utf8').digest('hex').toUpperCase();
        if (dig === md5) return true;
    }

    const senhaLatin = senhaBuf ? senhaBuf.toString('latin1') : senhaTxt;
    if (senhaLatin === plain || senhaLatin.trim() === plain) return true;

    const encodeKey = process.env.AUTH_ENCODE_KEY || 'papafila';
    const padded = plain.padEnd(10, ' ').slice(0, 10);
    const keys = [...new Set([
        encodeKey, matriculaBase, matriculaComDv, cnpjLinha, cnpj,
        'lumi', 'LUMI', 'sac', 'SAC', 'softlumi', 'SoftLumi', 'papafila',
    ].filter(Boolean))];
    for (const key of keys) {
        try {
            const [enc] = await pool.query(
                `SELECT 1 AS ok FROM funciona
                 WHERE MATRICULA = ? AND CNPJ = ?
                   AND (SENHA = ENCODE(?, ?) OR SENHA = ENCODE(?, ?))
                 LIMIT 1`,
                [matriculaBase, cnpjLinha, plain, key, padded, key]
            );
            if (enc && enc.length) return true;
            const [dec] = await pool.query(
                `SELECT 1 AS ok FROM funciona
                 WHERE MATRICULA = ? AND CNPJ = ?
                   AND (
                     TRIM(CAST(DECODE(SENHA, ?) AS CHAR CHARACTER SET latin1)) = ?
                     OR CAST(DECODE(SENHA, ?) AS CHAR CHARACTER SET latin1) = ?
                   )
                 LIMIT 1`,
                [matriculaBase, cnpjLinha, key, plain, key, plain]
            );
            if (dec && dec.length) return true;
        } catch (_e) { /* ENCODE/DECODE indisponível */ }
    }
    return false;
}

async function verifyFuncionaPassword(pool, opts) {
    const { matriculaBase, matriculaComDv, cnpj, plain } = opts;
    if (!plain || !matriculaBase) return false;

    const [rows] = await pool.query(
        `SELECT TRIM(MATRICULA) AS MATRICULA, CNPJ, SENHA, MD5_PANAMAH
         FROM funciona
         WHERE TRIM(MATRICULA) = ?
            OR LPAD(TRIM(MATRICULA), 6, '0') = ?
            OR CAST(TRIM(MATRICULA) AS UNSIGNED) = CAST(? AS UNSIGNED)
         ORDER BY CASE WHEN CNPJ = ? THEN 0 WHEN ? <> '' AND CNPJ = ? THEN 1 ELSE 2 END
         LIMIT 12`,
        [matriculaBase, matriculaBase, matriculaBase, cnpj || '', cnpj || '', cnpj || '']
    );
    for (const row of rows || []) {
        if (await senhaConfereNaLinhaFunciona(pool, row, {
            matriculaBase: String(row.MATRICULA || matriculaBase).trim(),
            matriculaComDv,
            cnpj: onlyDigits(row.CNPJ) || cnpj,
            plain,
        })) {
            return true;
        }
    }
    return false;
}

function selfCheck() {
    const hex = encodeSoftlumiPassword('2713');
    if (!hex || hex.toString('hex').toUpperCase() !== '82B2C7D278213ECEB9D8') {
        throw new Error('SoftLumi self-check falhou (vetor 2713).');
    }
    if (!softlumiPasswordMatches('2713', Buffer.from('82B2C7D278213ECEB9D8', 'hex'))) {
        throw new Error('SoftLumi match self-check falhou.');
    }
    const prev = process.env.NFE_ALTERAR_MATRICULAS;
    try {
        process.env.NFE_ALTERAR_MATRICULAS = '';
        if (!podeAlterarNfe({ matricula: '1' })) throw new Error('alterar: vazio deve liberar.');
        process.env.NFE_ALTERAR_MATRICULAS = '558';
        if (!podeAlterarNfe({ matricula: '0000558' })) throw new Error('alterar: 558 vs 0000558.');
        if (podeAlterarNfe({ matricula: '0000999' })) throw new Error('alterar: 999 deve bloquear.');
        const prevSkip = process.env.NFE_PULAR_LOGIN;
        try {
            process.env.NFE_PULAR_LOGIN = '';
            if (pularLogin()) throw new Error('pular login: vazio deve desligar.');
            process.env.NFE_PULAR_LOGIN = '1';
            if (!pularLogin()) throw new Error('pular login: 1 deve ligar.');
        } finally {
            if (prevSkip == null) delete process.env.NFE_PULAR_LOGIN;
            else process.env.NFE_PULAR_LOGIN = prevSkip;
        }
    } finally {
        if (prev == null) delete process.env.NFE_ALTERAR_MATRICULAS;
        else process.env.NFE_ALTERAR_MATRICULAS = prev;
    }
}
selfCheck();

function payloadSessao(user) {
    return {
        matricula: user.matricula,
        nome: user.nome,
        cnpj: user.cnpj,
        fantasia: user.fantasia,
        admin: Boolean(user.admin),
        todasLojas: Boolean(user.todasLojas),
        serverId: user.serverId || '',
    };
}

function gravarSessao(res, user) {
    const hours = sessionHours();
    const token = jwt.sign(payloadSessao(user), jwtSecret(), { expiresIn: `${hours}h` });
    setSessionCookie(res, token, hours);
    return hours;
}

function atualizarServidorSessao(req, res, serverId) {
    const user = lerUsuario(req);
    if (!user) return false;
    gravarSessao(res, { ...user, serverId });
    return true;
}

function registerAuthRoutes(app, opts) {
    const getPool = opts.getPool;
    const obterServidor = opts.obterServidor;
    const bindServer = opts.bindServer;
    const listarServidores = opts.listarServidores;
    const onServidorEscolhido = opts.onServidorEscolhido;

    function servidorDoPedido(req) {
        const sid = String((req.body && req.body.serverId) || (req.query && req.query.serverId) || '').trim();
        if (typeof obterServidor === 'function') return obterServidor(sid || null);
        try {
            return { id: sid, name: sid, pool: sid ? getPool(sid) : getPool() };
        } catch (_e) {
            return null;
        }
    }

    const autorizadas = matriculasAlteracao();
    console.log(autorizadas.length
        ? `[INFO] NFE_ALTERAR_MATRICULAS ativo: só ${autorizadas.join(', ')} veem Manutenção XML, Autorizar recepção XML e Aplicar Ações em Massa.`
        : '[INFO] NFE_ALTERAR_MATRICULAS vazio ou comentado no .env: todos veem Manutenção XML, Autorizar recepção XML e Aplicar Ações em Massa.');
    console.log(pularLogin()
        ? '[INFO] NFE_PULAR_LOGIN ativo: sistema sem senha (usa DEFAULT_SERVER).'
        : '[INFO] NFE_PULAR_LOGIN desligado: login obrigatório.');

    app.get('/login.html', (_req, res) => {
        if (pularLogin()) return res.redirect('/');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.sendFile(path.join(__dirname, 'login.html'));
    });
    app.get('/favicon.png', (_req, res) => res.sendFile(path.join(__dirname, 'favicon.png')));
    app.get('/logo-lumi.png', (_req, res) => res.sendFile(path.join(__dirname, 'logo-lumi.png')));

    app.get('/api/auth/servidores', (_req, res) => {
        const lista = typeof listarServidores === 'function' ? listarServidores() : [];
        const padrao = typeof obterServidor === 'function' ? obterServidor(null) : null;
        return res.json({
            servidores: lista,
            atual: padrao ? padrao.id : '',
            pularLogin: pularLogin(),
        });
    });

    app.get('/api/auth/estabelecimentos', async (req, res) => {
        try {
            const servidor = servidorDoPedido(req);
            if (!servidor) return res.status(400).json({ erro: 'Servidor inválido.', estabelecimentos: [] });
            const lista = await listarEstabelecimentos(servidor.pool);
            return res.json({ estabelecimentos: lista, serverId: servidor.id });
        } catch (error) {
            console.error('[AUTH estab]', error?.message || error);
            return res.status(503).json({ erro: 'Não foi possível listar os estabelecimentos.', estabelecimentos: [] });
        }
    });

    app.get('/api/auth/usuario', async (req, res) => {
        try {
            const servidor = servidorDoPedido(req);
            if (!servidor) return res.json({ nome: '' });
            const func = await buscarFuncionario(servidor.pool, req.query?.matricula || '');
            if (!func) return res.json({ nome: '' });
            return res.json({ nome: func.NOME || func.APELIDO || '' });
        } catch (error) {
            console.error('[AUTH usuario]', error?.message || error);
            return res.json({ nome: '' });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        const cnpjInformado = onlyDigits(req.body?.cnpj || req.body?.cnpj_loja || '');
        const senha = String(req.body?.senha || '');
        const { digits } = normalizeMatriculaInput(req.body?.matricula || '');
        if (!digits) {
            return res.status(400).json({ erro: 'Informe o usuário com dígito verificador.' });
        }
        if (!senha || senha.length > 10) {
            return res.status(400).json({ erro: 'Informe a senha (máximo 10 caracteres).' });
        }
        const servidor = servidorDoPedido(req);
        if (!servidor) {
            return res.status(400).json({ erro: 'Selecione um servidor válido.' });
        }
        try {
            const pool = servidor.pool;
            const func = await buscarFuncionario(pool, req.body?.matricula || '');
            if (!func) {
                return res.status(401).json({
                    erro: `Usuário não encontrado no servidor "${servidor.name}". Confira o servidor selecionado.`,
                });
            }
            const cnpjVinculo = onlyDigits(func.CNPJ);
            const ok = await verifyFuncionaPassword(pool, {
                matriculaBase: func.MATRICULA_BASE,
                matriculaComDv: func.MATRICULA_DV,
                cnpj: cnpjVinculo,
                plain: senha,
            });
            if (!ok) {
                return res.status(401).json({ erro: 'Usuário ou senha inválida.' });
            }

            const admin = isAdminAcesso(func.ACESSO);
            /** Qualquer usuário autenticado pode consultar todas as lojas (filtro livre na tela). */
            const todasLojas = true;
            let cnpjSessao = '';
            let fantasia = 'Todas as lojas';

            if (!escolheuTodasLojas(req.body?.cnpj) && cnpjInformado) {
                const [lojas] = await pool.query(
                    `SELECT CNPJ, FANTASIA, RAZAO FROM ESTAB
                     WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(CNPJ,''), '.', ''), '/', ''), '-', ''), ' ', '') = ?
                     LIMIT 1`,
                    [cnpjInformado]
                );
                if (!lojas || !lojas.length) {
                    return res.status(400).json({ erro: 'Selecione um estabelecimento válido.' });
                }
                cnpjSessao = onlyDigits(lojas[0].CNPJ);
                fantasia = lojas[0].FANTASIA || lojas[0].RAZAO || cnpjSessao;
            } else if (!cnpjInformado && !escolheuTodasLojas(req.body?.cnpj)) {
                const estabelecimentos = await listarEstabelecimentos(pool);
                return res.json({
                    ok: false,
                    precisaEstab: true,
                    estabelecimentos,
                    serverId: servidor.id,
                });
            }
            const user = {
                matricula: func.MATRICULA_DV,
                nome: func.NOME || func.APELIDO || func.MATRICULA_DV,
                cnpj: cnpjSessao,
                fantasia,
                admin,
                todasLojas,
                serverId: servidor.id,
            };
            if (typeof onServidorEscolhido === 'function') onServidorEscolhido(servidor.id);
            gravarSessao(res, user);
            return res.json({ ok: true, user });
        } catch (error) {
            console.error('[AUTH login]', error?.message || error);
            return res.status(500).json({ erro: 'Falha ao autenticar.' });
        }
    });

    app.post('/api/auth/logout', (_req, res) => {
        clearSessionCookie(res);
        return res.json({ ok: true });
    });

    app.get('/api/auth/me', (req, res) => {
        const logado = lerUsuario(req);
        const user = logado || (pularLogin() ? usuarioPularLogin(obterServidor) : null);
        if (!user) return res.status(401).json({ erro: 'Não autenticado.' });
        return res.json({
            matricula: user.matricula,
            nome: user.nome,
            cnpj: user.cnpj,
            fantasia: user.fantasia,
            admin: Boolean(user.admin),
            todasLojas: Boolean(user.todasLojas),
            serverId: user.serverId || '',
            podeAlterar: podeAlterarNfe(user),
            pularLogin: Boolean(user.pularLogin),
        });
    });
}

function installAuthGate(app, opts) {
    const obterServidor = opts.obterServidor;
    const bindServer = opts.bindServer;

    app.use((req, res, next) => {
        if (res.headersSent) return next();
        if (caminhoPublico(req)) return next();
        const user = lerUsuario(req) || (pularLogin() ? usuarioPularLogin(obterServidor) : null);
        if (user) {
            req.usuario = user;
            if (typeof bindServer === 'function') return bindServer(user.serverId, next);
            return next();
        }
        if (querHtml(req)) return res.redirect('/login.html');
        return res.status(401).json({ erro: 'Faça login para continuar.' });
    });

    app.use((req, res, next) => {
        if (req.method !== 'POST') return next();
        const p = pathRequisicao(req);
        if (!(p.startsWith('/xml-salvar/') || p.startsWith('/itemcomp/'))) return next();
        if (podeAlterarNfe(req.usuario)) return next();
        return res.status(403).json({ erro: 'Sem permissão para alterar.' });
    });
}

module.exports = {
    registerAuthRoutes,
    installAuthGate,
    encodeSoftlumiPassword,
    softlumiPasswordMatches,
    normalizeMatriculaInput,
    cnpjEfetivo,
    cnpjDaSessao,
    atualizarServidorSessao,
};
