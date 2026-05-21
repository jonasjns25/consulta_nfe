'use strict';

/**
 * Serviço de consulta à SEFAZ por chave de acesso (NF-e).
 *
 * Estratégias para obter o certificado A1 (PFX):
 *   1) Thumbprint informado manualmente pelo usuário (modal no frontend).
 *   2) PFX via variáveis de ambiente (SEFAZ_PFX_PATH / SEFAZ_PFX_PASS, ou por CNPJ).
 *   3) Export automático do repositório Pessoal do Windows via PowerShell,
 *      buscando o cert cujo Subject contenha o CNPJ.
 *
 * IMPORTANTE: Evitamos `ConvertTo-SecureString` porque em alguns ambientes o
 * módulo Microsoft.PowerShell.Security não carrega. Usamos `.NET` direto.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DistribuicaoDFe } = require('node-mde');

let winca = null;
try {
    winca = require('win-ca/api');
} catch (_err) {
    winca = null;
}

const MAP_UF = {
    AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23',
    DF: '53', ES: '32', GO: '52', MA: '21', MT: '51', MS: '50',
    MG: '31', PA: '15', PB: '25', PR: '41', PE: '26', PI: '22',
    RJ: '33', RN: '24', RS: '43', RO: '11', RR: '14', SC: '42',
    SP: '35', SE: '28', TO: '17',
};

/** Apenas dígitos; vazio se inválido. */
function apenasDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
}

/** Raiz do CNPJ (8 primeiros dígitos) — mesma empresa (matriz/filiais). */
function raizCnpj(cnpj) {
    return apenasDigitos(cnpj).slice(0, 8);
}

/** Extrai todos os CNPJs de 14 dígitos presentes em um texto (Subject, CN, etc.). */
function extrairCnpjsDoTexto(texto) {
    const matches = String(texto || '').match(/\d{14}/g);
    return matches ? [...new Set(matches)] : [];
}

/**
 * Certificado e-CNPJ da matriz é válido para filiais com a mesma raiz.
 * Compara CNPJ completo ou raiz (8 dígitos).
 */
function certificadoCompativelComEstabelecimento(textoCert, cnpjEstabelecimento) {
    const estab = apenasDigitos(cnpjEstabelecimento);
    if (estab.length !== 14) return false;
    const raizEstab = estab.slice(0, 8);
    const cnpjsNoCert = extrairCnpjsDoTexto(textoCert);
    if (cnpjsNoCert.some((c) => c === estab)) return true;
    return cnpjsNoCert.some((c) => c.slice(0, 8) === raizEstab);
}

/** Extrai o CNPJ (14 dígitos) do campo CERTIFICADO_NFE (Distinguished Name). */
function extrairCnpjDoDN(dnCertificado) {
    if (!dnCertificado) {
        throw new Error('Campo CERTIFICADO_NFE vazio.');
    }
    const match = String(dnCertificado).match(/CN=.*?:(\d{14})/i);
    if (!match) {
        const alt = String(dnCertificado).match(/(\d{14})/);
        if (alt) return alt[1];
        throw new Error(
            'Não foi possível extrair o CNPJ do campo CERTIFICADO_NFE.\n' +
            `Valor recebido: "${dnCertificado}"`
        );
    }
    return match[1];
}

/** Executa um script PowerShell e devolve { stdout, stderr, code }. */
function executarPowerShell(script) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(os.tmpdir(), `sefaz-ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
        fs.writeFileSync(scriptPath, script, { encoding: 'utf8' });

        const child = spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
            { windowsHide: true }
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
        child.on('error', (err) => {
            try { fs.unlinkSync(scriptPath); } catch (_e) { /* ignora */ }
            reject(err);
        });
        child.on('close', (code) => {
            try { fs.unlinkSync(scriptPath); } catch (_e) { /* ignora */ }
            resolve({ stdout, stderr, code });
        });
    });
}

/**
 * Lista todos os certificados do repositório Pessoal do Windows (CurrentUser\My e
 * LocalMachine\My), retornando Thumbprint, Subject, Issuer, NotAfter, HasPrivateKey.
 *
 * Retorna { lista, debug } onde `debug` contém stdout/stderr/code para diagnóstico
 * quando a lista vem vazia.
 */
async function listarCertsPowerShell() {
    if (process.platform !== 'win32') {
        return { lista: [], debug: { motivo: 'Plataforma não Windows.', platform: process.platform } };
    }

    // Usa .NET direto (X509Store) em vez de `Cert:\` provider, que em alguns
    // ambientes (sessões de serviço/tarefa agendada) não está registrado.
    const script = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '$ErrorActionPreference = "Continue"',
        'Add-Type -AssemblyName System.Security 2>$null',
        '$out = @()',
        '$locais = @(',
        '  @{ Nome = "CurrentUser\\My"; Location = [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser; Name = "My" },',
        '  @{ Nome = "LocalMachine\\My"; Location = [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine; Name = "My" }',
        ')',
        'foreach ($loc in $locais) {',
        '  try {',
        '    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($loc.Name, $loc.Location)',
        '    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)',
        '    foreach ($c in $store.Certificates) {',
        '      $out += [pscustomobject]@{',
        '        Store = $loc.Nome',
        '        Thumbprint = $c.Thumbprint',
        '        Subject = $c.Subject',
        '        Issuer = $c.Issuer',
        '        NotAfter = $c.NotAfter.ToString("o")',
        '        NotBefore = $c.NotBefore.ToString("o")',
        '        HasPrivateKey = [bool]$c.HasPrivateKey',
        '      }',
        '    }',
        '    $store.Close()',
        '  } catch {',
        '    Write-Error ("Falha ao abrir " + $loc.Nome + ": " + $_.Exception.Message)',
        '  }',
        '}',
        '# Força array JSON mesmo quando há um único item ou zero itens',
        'if ($out.Count -eq 0) {',
        '  Write-Output "[]"',
        '} elseif ($out.Count -eq 1) {',
        '  Write-Output ("[" + ($out[0] | ConvertTo-Json -Depth 4 -Compress) + "]")',
        '} else {',
        '  Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)',
        '}',
    ].join('\r\n');

    const debug = { stdout: '', stderr: '', code: null };
    try {
        const { stdout, stderr, code } = await executarPowerShell(script);
        debug.stdout = stdout;
        debug.stderr = stderr;
        debug.code = code;
        const txt = (stdout || '').trim();
        if (!txt) return { lista: [], debug };
        let data;
        try { data = JSON.parse(txt); }
        catch (e) {
            debug.parseError = e.message;
            return { lista: [], debug };
        }
        if (!Array.isArray(data)) data = [data];
        // Proteção: algumas versões do PowerShell duplicam o wrapping em array.
        // Se cada item for um array, achata um nível. Filtra objetos com Thumbprint.
        data = data.flat(2).filter((x) => x && typeof x === 'object' && x.Thumbprint);
        return { lista: data, debug };
    } catch (err) {
        debug.erroExec = err?.message || String(err);
        return { lista: [], debug };
    }
}

/**
 * Snippet PowerShell comum: abre as stores CurrentUser\My e LocalMachine\My
 * via .NET e deixa cada cert acessível em $allCerts (array de X509Certificate2).
 */
const SNIPPET_ABRIR_STORES = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$allCerts = New-Object System.Collections.ArrayList',
    '$locais = @(',
    '  @{ Nome = "CurrentUser\\My"; Location = [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser; Name = "My" },',
    '  @{ Nome = "LocalMachine\\My"; Location = [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine; Name = "My" }',
    ')',
    'foreach ($loc in $locais) {',
    '  try {',
    '    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($loc.Name, $loc.Location)',
    '    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)',
    '    foreach ($c in $store.Certificates) { [void]$allCerts.Add($c) }',
    '    $store.Close()',
    '  } catch { Write-Error ("Falha ao abrir store " + $loc.Nome + ": " + $_.Exception.Message) }',
    '}',
].join('\r\n');

/**
 * Exporta um certificado específico (por Thumbprint) para PFX temporário.
 * Usa .NET puro (X509Store + X509Certificate2.Export) para evitar dependência
 * do provider `Cert:` e do cmdlet Export-PfxCertificate.
 */
async function exportarPfxPorThumbprint(thumbprint) {
    if (process.platform !== 'win32') {
        throw new Error('Export automático só é suportado em Windows.');
    }
    const thumbClean = String(thumbprint || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    if (thumbClean.length < 20) {
        throw new Error('Thumbprint inválido.');
    }
    const pwd = 'sf_' + Math.random().toString(36).slice(2, 14);
    const pfxPath = path.join(os.tmpdir(), `sefaz-thumb-${thumbClean.slice(0, 10)}-${Date.now()}.pfx`);
    const pwdEscapado = pwd.replace(/'/g, "''");

    const script = [
        SNIPPET_ABRIR_STORES,
        '$thumb = "' + thumbClean + '"',
        '$pfxPath = "' + pfxPath.replace(/\\/g, '\\\\') + '"',
        '$pwd = \'' + pwdEscapado + '\'',
        '$cert = $allCerts | Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1',
        'if ($null -eq $cert) {',
        '  Write-Error ("Certificado com thumbprint " + $thumb + " nao encontrado. Total visiveis: " + $allCerts.Count)',
        '  exit 2',
        '}',
        'if (-not $cert.HasPrivateKey) {',
        '  Write-Error ("O certificado selecionado nao possui chave privada associada (somente o publico esta instalado).")',
        '  exit 3',
        '}',
        '# Detecta o tipo do provider da chave privada (CAPI / CNG / SmartCard)',
        '$tipoProvider = "desconhecido"',
        'try {',
        '  $priv = $cert.PrivateKey',
        '  if ($priv) { $tipoProvider = "CAPI" }',
        '} catch { $tipoProvider = "CNG_ou_indisponivel" }',
        '',
        '# Tentativa 1: .NET Export() - funciona com CAPI exportavel e CNG com PLAINTEXTEXPORT',
        '$erroNet = $null',
        'try {',
        '  $bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $pwd)',
        '  [System.IO.File]::WriteAllBytes($pfxPath, $bytes)',
        '  Write-Output "OK-NET"',
        '  exit 0',
        '} catch {',
        '  $erroNet = $_.Exception.Message',
        '}',
        '',
        '# Tentativa 2: Export-PfxCertificate cmdlet (PFXExportCertStoreEx nativo)',
        '$erroCmdlet = $null',
        'try {',
        '  $secpwd = New-Object System.Security.SecureString',
        '  foreach ($ch in [char[]]$pwd) { $secpwd.AppendChar($ch) }',
        '  $secpwd.MakeReadOnly()',
        '  Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secpwd -ChainOption EndEntityCertOnly -Force -ErrorAction Stop | Out-Null',
        '  Write-Output "OK-CMDLET"',
        '  exit 0',
        '} catch {',
        '  $erroCmdlet = $_.Exception.Message',
        '}',
        '',
        '# Falhou tudo: monta diagnostico detalhado',
        '$diag = "Provider detectado: " + $tipoProvider + ". "',
        '$diag += "Erro .NET Export: " + $erroNet + ". "',
        '$diag += "Erro Export-PfxCertificate: " + $erroCmdlet + ". "',
        'if ($erroNet -match "Chave inválida" -or $erroNet -match "not valid for use") {',
        '  $diag += "Causa provavel: o certificado foi importado sem a opcao ""Marcar chave como exportavel"" OU e um A3 (token/smartcard). "',
        '  $diag += "Solucao: reimporte o .pfx marcando ""Marcar esta chave como exportavel""; se for A3, nao ha como exportar a chave privada."',
        '}',
        'Write-Error $diag',
        'exit 4',
    ].join('\r\n');

    try {
        const { stdout, stderr, code } = await executarPowerShell(script);
        if (code !== 0 || !fs.existsSync(pfxPath)) {
            const msg = (stderr || stdout || '').trim() || `PowerShell encerrou com código ${code}`;
            throw new Error(msg);
        }
        const pfxBuffer = fs.readFileSync(pfxPath);
        return { pfx: pfxBuffer, passphrase: pwd };
    } finally {
        try { fs.unlinkSync(pfxPath); } catch (_e) { /* ignora */ }
    }
}

/**
 * Exporta (automaticamente) o certificado cujo Subject contenha o CNPJ.
 * Tenta cada candidato encontrado; retorna o primeiro que conseguir exportar.
 */
async function exportarPfxPorCnpj(cnpj) {
    if (process.platform !== 'win32') {
        throw new Error('Export automático só é suportado em Windows.');
    }
    const pwd = 'sf_' + Math.random().toString(36).slice(2, 14);
    const pfxPath = path.join(os.tmpdir(), `sefaz-${cnpj}-${Date.now()}.pfx`);
    const pwdEscapado = pwd.replace(/'/g, "''");

    const script = [
        SNIPPET_ABRIR_STORES,
        '$cnpj = "' + cnpj + '"',
        '$pfxPath = "' + pfxPath.replace(/\\/g, '\\\\') + '"',
        '$pwd = \'' + pwdEscapado + '\'',
        '$raiz = if ($cnpj.Length -ge 8) { $cnpj.Substring(0, 8) } else { $cnpj }',
        '$candidatos = $allCerts | Where-Object {',
        '  $subj = $_.Subject',
        '  if ($subj -like ("*" + $cnpj + "*")) { return $true }',
        '  if ($raiz.Length -eq 8 -and $subj -match $raiz) { return $true }',
        '  return $false',
        '} | Sort-Object NotAfter -Descending',
        'if ($candidatos.Count -eq 0) {',
        '  Write-Error ("Nenhum certificado com CNPJ ou raiz " + $cnpj + " encontrado. Total visiveis: " + $allCerts.Count)',
        '  exit 2',
        '}',
        '$tentativas = @()',
        '$ok = $false',
        'foreach ($c in $candidatos) {',
        '  $info = [pscustomobject]@{',
        '    Thumbprint = $c.Thumbprint',
        '    Subject = $c.Subject',
        '    NotAfter = $c.NotAfter.ToString("o")',
        '    HasPrivateKey = [bool]$c.HasPrivateKey',
        '    Erro = ""',
        '  }',
        '  if (-not $c.HasPrivateKey) { $info.Erro = "Sem chave privada"; $tentativas += $info; continue }',
        '  $erroNet = $null',
        '  try {',
        '    $bytes = $c.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $pwd)',
        '    [System.IO.File]::WriteAllBytes($pfxPath, $bytes)',
        '    $info.Erro = "OK (.NET)"',
        '    $tentativas += $info',
        '    $ok = $true',
        '    break',
        '  } catch { $erroNet = $_.Exception.Message }',
        '  try {',
        '    $secpwd = New-Object System.Security.SecureString',
        '    foreach ($ch in [char[]]$pwd) { $secpwd.AppendChar($ch) }',
        '    $secpwd.MakeReadOnly()',
        '    Export-PfxCertificate -Cert $c -FilePath $pfxPath -Password $secpwd -ChainOption EndEntityCertOnly -Force -ErrorAction Stop | Out-Null',
        '    $info.Erro = "OK (cmdlet)"',
        '    $tentativas += $info',
        '    $ok = $true',
        '    break',
        '  } catch {',
        '    $info.Erro = ".NET: " + $erroNet + " | cmdlet: " + $_.Exception.Message',
        '    $tentativas += $info',
        '  }',
        '}',
        'if ($tentativas.Count -eq 0) { Write-Output "[]" }',
        'elseif ($tentativas.Count -eq 1) { Write-Output ("[" + ($tentativas[0] | ConvertTo-Json -Depth 4 -Compress) + "]") }',
        'else { Write-Output ($tentativas | ConvertTo-Json -Depth 4 -Compress) }',
        'if (-not $ok) { exit 3 }',
    ].join('\r\n');

    const { stdout, stderr, code } = await executarPowerShell(script);
    if (code !== 0 || !fs.existsSync(pfxPath)) {
        const resumo = (stdout || '').trim();
        const msg = resumo || (stderr || '').trim() || `PowerShell encerrou com código ${code}`;
        throw new Error(msg);
    }
    try {
        const pfxBuffer = fs.readFileSync(pfxPath);
        return { pfx: pfxBuffer, passphrase: pwd };
    } finally {
        try { fs.unlinkSync(pfxPath); } catch (_e) { /* ignora */ }
    }
}

/**
 * Retorna { pfx, passphrase } para uso no node-mde.
 * @param {string} cnpj CNPJ extraído do DN (usado para fallback por CNPJ).
 * @param {string} [thumbprint] Se informado, ignora a busca por CNPJ e usa o cert específico.
 */
async function obterCredenciais(cnpj, thumbprint) {
    if (thumbprint) {
        return await exportarPfxPorThumbprint(thumbprint);
    }

    const pfxEnvPath = process.env[`SEFAZ_PFX_PATH_${cnpj}`] || process.env.SEFAZ_PFX_PATH;
    const pfxEnvPass = process.env[`SEFAZ_PFX_PASS_${cnpj}`] || process.env.SEFAZ_PFX_PASS || '';
    if (pfxEnvPath && fs.existsSync(pfxEnvPath)) {
        return { pfx: fs.readFileSync(pfxEnvPath), passphrase: pfxEnvPass };
    }

    try {
        return await exportarPfxPorCnpj(cnpj);
    } catch (errExport) {
        const { lista } = await listarCertsPowerShell();
        const compativeis = lista.filter((c) =>
            certificadoCompativelComEstabelecimento(c.Subject, cnpj)
        );
        const listaStr = compativeis.slice(0, 5)
            .map((c) => ` - [${c.Thumbprint}] ${c.Subject} (HasPrivateKey=${c.HasPrivateKey})`)
            .join('\n');
        const erro = new Error(
            `Não foi possível obter o PFX para o CNPJ ${cnpj}.\n` +
            (compativeis.length > 0
                ? `Certificados com esse CNPJ no Windows:\n${listaStr}\n`
                : (lista.length > 0
                    ? `Nenhum cert com esse CNPJ no Pessoal. ${lista.length} cert(s) visível(is) no total.\n`
                    : 'Nada visível no repositório Pessoal.\n')) +
            `Detalhe do export automático: ${errExport.message}\n` +
            'Você pode tentar selecionar o certificado manualmente ou configurar um PFX no .env.'
        );
        erro.permiteSelecaoManual = true;
        throw erro;
    }
}

/** Cria a instância DistribuicaoDFe (node-mde) para o estabelecimento. */
async function criarDistribuicao(cnpj, uf, tpAmb, thumbprint) {
    const cUFAutor = MAP_UF[String(uf || '').toUpperCase()];
    if (!cUFAutor) {
        throw new Error(`UF inválida ou não mapeada: "${uf}"`);
    }
    const cred = await obterCredenciais(cnpj, thumbprint);
    return new DistribuicaoDFe({
        ...cred,
        cnpj,
        cUFAutor,
        tpAmb: tpAmb || '1',
    });
}

/**
 * Consulta o XML de uma NF-e na SEFAZ a partir da chave.
 * @param {string} chave   44 dígitos
 * @param {string} dnCert  valor de ESTAB.CERTIFICADO_NFE
 * @param {string} uf      sigla da UF do estabelecimento
 * @param {object} [opts]  { tpAmb, thumbprint }
 */
async function consultarXmlPorChave(chave, dnCert, uf, opts = {}) {
    const { tpAmb = '1', thumbprint } = opts || {};
    const chaveLimpa = String(chave || '').replace(/\D/g, '');
    if (chaveLimpa.length !== 44) {
        throw new Error('Chave de acesso inválida. Deve conter exatamente 44 dígitos.');
    }
    const cnpj = extrairCnpjDoDN(dnCert);
    const distribuicao = await criarDistribuicao(cnpj, uf, tpAmb, thumbprint);

    const resultado = await distribuicao.consultaChNFe(chaveLimpa);
    if (resultado.error) {
        throw new Error(`Erro ao consultar SEFAZ: ${resultado.error}`);
    }
    const cStat = resultado.data?.cStat;
    const xMotivo = resultado.data?.xMotivo;
    const docs = resultado.data?.docZip;
    if (!docs || docs.length === 0) {
        throw new Error(
            `Nenhum documento retornado pela SEFAZ (cStat=${cStat || '-'} ${xMotivo || ''}). ` +
            'Verifique se a chave está correta e se o CNPJ do estabelecimento é o ' +
            'destinatário desta NF-e.'
        );
    }
    const doc = docs.find((d) => String(d.schema || '').startsWith('procNFe'))
        || docs.find((d) => String(d.schema || '').startsWith('resNFe'))
        || docs[0];
    return { xml: doc.xml, cnpj, schema: doc.schema };
}

/** Diagnóstico: lista certificados disponíveis + info de ambiente. */
async function diagnosticarCertificados(cnpj) {
    const { lista, debug } = await listarCertsPowerShell();
    return {
        plataforma: process.platform,
        totalCerts: lista.length,
        certificados: lista,
        debug,
        pfxEnvPath: (cnpj && process.env[`SEFAZ_PFX_PATH_${cnpj}`]) || process.env.SEFAZ_PFX_PATH || null,
    };
}

/**
 * Extrai um "nome amigável" (CN) do Subject para exibição na UI.
 * Ex.: "CN=COMERCIAL ARMAZEM LTDA:15589854000122, OU=..." → "COMERCIAL ARMAZEM LTDA:15589854000122"
 */
function extrairCN(subject) {
    const m = String(subject || '').match(/CN=([^,]+)/i);
    return m ? m[1].trim() : (subject || '');
}

/** Lista certificados formatados para exibição no frontend. Retorna { certificados, debug }. */
async function listarCertificadosParaUI() {
    const { lista, debug } = await listarCertsPowerShell();
    const certificados = lista.map((c) => {
        const cnpjs = extrairCnpjsDoTexto(c.Subject);
        return {
            thumbprint: c.Thumbprint,
            nome: extrairCN(c.Subject),
            subject: c.Subject,
            cnpj: cnpjs[0] || null,
            cnpjs,
            issuer: extrairCN(c.Issuer),
            notAfter: c.NotAfter,
            notBefore: c.NotBefore,
            hasPrivateKey: c.HasPrivateKey,
            store: c.Store,
        };
    });
    return { certificados, debug };
}

module.exports = {
    raizCnpj,
    certificadoCompativelComEstabelecimento,
    extrairCnpjsDoTexto,
    consultarXmlPorChave,
    extrairCnpjDoDN,
    diagnosticarCertificados,
    listarCertificadosParaUI,
    MAP_UF,
};
