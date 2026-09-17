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

function caminhoPublico(req) {
    const p = String(req.path || '').split('?')[0];
    if (p === '/login.html' || p === '/logo-lumi.png' || p === '/favicon.ico') return true;
    if (req.method === 'GET' && p === '/api/auth/estabelecimentos') return true;
    if (req.method === 'POST' && p === '/api/auth/login') return true;
    if (req.method === 'POST' && p === '/api/auth/logout') return true;
    return false;
}

function querHtml(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const p = String(req.path || '');
    if (p === '/' || p.endsWith('.html')) return true;
    return String(req.headers.accept || '').includes('text/html');
}

async function verifyFuncionaPassword(pool, opts) {
    const { matriculaBase, matriculaComDv, cnpj, plain } = opts;
    if (!plain) return false;
    const [rows] = await pool.query(
        'SELECT SENHA, MD5_PANAMAH FROM funciona WHERE MATRICULA = ? AND CNPJ = ? LIMIT 1',
        [matriculaBase, cnpj]
    );
    const row = rows && rows[0];
    if (!row) return false;

    const senhaBuf = senhaToBuffer(row.SENHA);
    if (senhaBuf && senhaBuf.length === 10) {
        return softlumiPasswordMatches(plain, senhaBuf);
    }

    const md5 = String(row.MD5_PANAMAH || '').trim().toUpperCase();
    if (md5 && md5 !== 'D41D8CD98F00B204E9800998ECF8427E') {
        const dig = crypto.createHash('md5').update(plain, 'utf8').digest('hex').toUpperCase();
        if (dig === md5) return true;
    }

    const senhaLatin = senhaBuf ? senhaBuf.toString('latin1') : '';
    if (senhaLatin === plain || senhaLatin.trim() === plain) return true;

    const encodeKey = process.env.AUTH_ENCODE_KEY || 'papafila';
    const padded = plain.padEnd(10, ' ').slice(0, 10);
    const keys = [...new Set([encodeKey, matriculaBase, matriculaComDv, cnpj, 'lumi', 'LUMI', 'sac', 'SAC', 'softlumi', 'SoftLumi'].filter(Boolean))];
    for (const key of keys) {
        const [enc] = await pool.query(
            `SELECT 1 AS ok FROM funciona
             WHERE MATRICULA = ? AND CNPJ = ?
               AND (SENHA = ENCODE(?, ?) OR SENHA = ENCODE(?, ?))
             LIMIT 1`,
            [matriculaBase, cnpj, plain, key, padded, key]
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
            [matriculaBase, cnpj, key, plain, key, plain]
        );
        if (dec && dec.length) return true;
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
}
selfCheck();

function registerAuthRoutes(app, { getPool }) {
    app.get('/login.html', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.sendFile(path.join(__dirname, 'login.html'));
    });

    app.get('/api/auth/estabelecimentos', async (_req, res) => {
        try {
            const lista = await listarEstabelecimentos(getPool());
            return res.json({ estabelecimentos: lista });
        } catch (error) {
            console.error('[AUTH estab]', error?.message || error);
            return res.status(503).json({ erro: 'Não foi possível listar os estabelecimentos.', estabelecimentos: [] });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        const cnpjInformado = onlyDigits(req.body?.cnpj || req.body?.cnpj_loja || '');
        const senha = String(req.body?.senha || '');
        const { digits, withDvInput } = normalizeMatriculaInput(req.body?.matricula || '');
        if (!digits) {
            return res.status(400).json({ erro: 'Informe a matrícula com dígito verificador.' });
        }
        if (!senha || senha.length > 10) {
            return res.status(400).json({ erro: 'Informe a senha (máximo 10 caracteres).' });
        }
        try {
            const pool = getPool();
            const [funcs] = await pool.query(
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
            const func = funcs && funcs[0];
            if (!func) {
                return res.status(401).json({ erro: 'Matrícula ou senha inválida.' });
            }
            if (estaDesligado(func.DESLIGADO)) {
                return res.status(401).json({ erro: 'Matrícula ou senha inválida.' });
            }
            const cnpjVinculo = onlyDigits(func.CNPJ);
            const ok = await verifyFuncionaPassword(pool, {
                matriculaBase: func.MATRICULA_BASE,
                matriculaComDv: func.MATRICULA_DV,
                cnpj: cnpjVinculo,
                plain: senha,
            });
            if (!ok) {
                return res.status(401).json({ erro: 'Matrícula ou senha inválida.' });
            }

            const admin = isAdminAcesso(func.ACESSO);
            let cnpjSessao = cnpjVinculo;
            if (admin) {
                if (!cnpjInformado) {
                    const estabelecimentos = await listarEstabelecimentos(pool);
                    return res.json({
                        ok: false,
                        precisaEstab: true,
                        estabelecimentos,
                    });
                }
                const [lojasAdmin] = await pool.query(
                    'SELECT CNPJ, FANTASIA, RAZAO FROM ESTAB WHERE CNPJ = ? LIMIT 1',
                    [cnpjInformado]
                );
                if (!lojasAdmin || !lojasAdmin.length) {
                    return res.status(400).json({ erro: 'Selecione um estabelecimento válido.' });
                }
                cnpjSessao = onlyDigits(lojasAdmin[0].CNPJ);
            }

            const [lojas] = await pool.query(
                'SELECT CNPJ, FANTASIA, RAZAO FROM ESTAB WHERE CNPJ = ? LIMIT 1',
                [cnpjSessao]
            );
            const loja = (lojas && lojas[0]) || { CNPJ: cnpjSessao };
            const hours = sessionHours();
            const user = {
                matricula: func.MATRICULA_DV,
                nome: func.NOME || func.APELIDO || func.MATRICULA_DV,
                cnpj: cnpjSessao,
                fantasia: loja.FANTASIA || loja.RAZAO || cnpjSessao,
                admin,
            };
            const token = jwt.sign(user, jwtSecret(), { expiresIn: `${hours}h` });
            setSessionCookie(res, token, hours);
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
        const user = lerUsuario(req);
        if (!user) return res.status(401).json({ erro: 'Não autenticado.' });
        return res.json({
            matricula: user.matricula,
            nome: user.nome,
            cnpj: user.cnpj,
            fantasia: user.fantasia,
            admin: Boolean(user.admin),
        });
    });

    app.use((req, res, next) => {
        if (caminhoPublico(req)) return next();
        const user = lerUsuario(req);
        if (user) {
            req.usuario = user;
            return next();
        }
        if (querHtml(req)) return res.redirect('/login.html');
        return res.status(401).json({ erro: 'Faça login para continuar.' });
    });
}

module.exports = {
    registerAuthRoutes,
    encodeSoftlumiPassword,
    softlumiPasswordMatches,
    normalizeMatriculaInput,
};
