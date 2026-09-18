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
const { XMLParser } = require('fast-xml-parser');
const { DistribuicaoDFe } = require('node-mde');

const parserStatusXml = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    parseAttributeValue: false,
    removeNSPrefix: true,
});

const https = require('https');
const zlib = require('zlib');
const axios = require('axios');

const SVRS_CONSULTA_PROT = 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx';
const SVRS_CONSULTA_PROT_HOM = 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx';
const SVAN_CONSULTA_PROT = 'https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx';

const SVRS_CTE_CONSULTA = 'https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx';
const SVRS_CTE_CONSULTA_HOM = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx';

/** URLs do webservice CTeConsultaV4 (consulta situação por chave). */
const MAP_CTE_CONSULTA = {
    11: SVRS_CTE_CONSULTA, 12: SVRS_CTE_CONSULTA,
    13: 'https://cte.sefaz.am.gov.br/webservices/CTeConsultaV4/CTeConsultaV4.asmx',
    14: SVRS_CTE_CONSULTA, 15: SVRS_CTE_CONSULTA, 16: SVRS_CTE_CONSULTA, 17: SVRS_CTE_CONSULTA,
    21: SVRS_CTE_CONSULTA, 22: SVRS_CTE_CONSULTA,
    23: 'https://cte.sefaz.ce.gov.br/webservices/CTeConsultaV4/CTeConsultaV4.asmx',
    24: SVRS_CTE_CONSULTA, 25: SVRS_CTE_CONSULTA,
    26: 'https://cte.sefaz.pe.gov.br/cte/services/CTeConsultaV4',
    27: SVRS_CTE_CONSULTA, 28: SVRS_CTE_CONSULTA,
    29: 'https://cte.sefaz.ba.gov.br/webservices/CTeConsultaV4/CTeConsultaV4.asmx',
    31: 'https://cte.fazenda.mg.gov.br/cte/services/CTeConsultaV4',
    32: SVRS_CTE_CONSULTA, 33: SVRS_CTE_CONSULTA,
    35: 'https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx',
    41: 'https://cte.fazenda.pr.gov.br/cte4/CTeConsultaV4',
    42: SVRS_CTE_CONSULTA,
    43: 'https://cte.sefazrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx',
    50: 'https://producao.cte.ms.gov.br/ws/CTeConsultaV4',
    51: 'https://cte.sefaz.mt.gov.br/ctews2/services/CTeConsultaV4',
    52: 'https://cte.sefaz.go.gov.br/cte/services/CTeConsultaV4',
    53: SVRS_CTE_CONSULTA,
};

const CSTAT_CONSULTA_CTE_OK = ['100', '101', '110', '150', '151', '155', '301', '302', '303'];

const MAP_CONSULTA_PROTOCOLO = {
    11: SVRS_CONSULTA_PROT, 12: SVRS_CONSULTA_PROT,
    13: 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
    14: SVRS_CONSULTA_PROT, 15: SVAN_CONSULTA_PROT, 16: SVRS_CONSULTA_PROT, 17: SVRS_CONSULTA_PROT,
    21: SVAN_CONSULTA_PROT, 22: SVRS_CONSULTA_PROT,
    23: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeConsultaProtocolo4',
    24: SVRS_CONSULTA_PROT, 25: SVRS_CONSULTA_PROT,
    26: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    27: SVRS_CONSULTA_PROT, 28: SVRS_CONSULTA_PROT,
    29: 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    31: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    32: SVRS_CONSULTA_PROT, 33: SVRS_CONSULTA_PROT,
    35: 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
    41: 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
    42: SVRS_CONSULTA_PROT,
    43: 'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    50: 'https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
    51: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
    52: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',
    53: SVRS_CONSULTA_PROT,
};

let winca = null;
try {
    winca = require('win-ca/api');
} catch (_err) {
    winca = null;
}

const ROOT = __dirname;

/** Erro estruturado para falhas de certificado (mensagem amigável na UI). */
class ErroCertificadoSefaz extends Error {
    constructor(mensagem, opts = {}) {
        super(mensagem);
        this.name = 'ErroCertificadoSefaz';
        this.codigo = opts.codigo || 'CERTIFICADO';
        this.permiteSelecaoManual = opts.permiteSelecaoManual !== false;
        this.orientacao = opts.orientacao || '';
    }
}

function mensagemIndicaChaveNaoExportavel(msg) {
    const t = String(msg || '').toLowerCase();
    return (
        t.includes('não exportável') ||
        t.includes('nao exportavel') ||
        t.includes('not exportable') ||
        t.includes('chave inválida') ||
        t.includes('chave invalida') ||
        t.includes('not valid for use') ||
        t.includes('não é possível exportar chave privada') ||
        t.includes('nao e possivel exportar chave privada')
    );
}

function erroCertificadoNaoExportavel(detalheTecnico) {
    return new ErroCertificadoSefaz(
        'O certificado instalado no Windows não permite exportar a chave privada (necessário para o Node.js assinar a consulta SEFAZ).',
        {
            codigo: 'CERT_NAO_EXPORTAVEL',
            permiteSelecaoManual: false,
            orientacao:
                'Soluções:\n' +
                '1) Configure no .env o caminho de um arquivo .pfx exportável:\n' +
                '   SEFAZ_PFX_PATH=C:\\caminho\\certificado.pfx\n' +
                '   SEFAZ_PFX_PASS=senha_do_pfx\n' +
                '   (ou SEFAZ_PFX_PATH_<CNPJ14> / SEFAZ_PFX_PASS_<CNPJ14>)\n' +
                '2) Coloque o .pfx na pasta Certificados\\ do sistema (nome com o CNPJ).\n' +
                '3) Reimporte o A1 no Windows marcando "Marcar esta chave como exportável".\n' +
                '4) Token A3 (smartcard) não funciona com este método — use .pfx em arquivo.\n' +
                (detalheTecnico ? `\nDetalhe técnico: ${detalheTecnico}` : ''),
        }
    );
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

/** Extrai CNPJs de 14 dígitos (seguidos ou formatados 00.000.000/0000-00). */
function extrairCnpjsDoTexto(texto) {
    const s = String(texto || '');
    const achados = new Set(s.match(/\d{14}/g) || []);
    for (const m of s.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}/g) || []) {
        const d = m.replace(/\D/g, '');
        if (d.length === 14) achados.add(d);
    }
    return [...achados];
}

/**
 * Certificado e-CNPJ da matriz é válido para filiais com a mesma raiz.
 * Compara CNPJ completo ou raiz (8 dígitos), inclusive com pontuação.
 */
function certificadoCompativelComEstabelecimento(textoCert, cnpjEstabelecimento) {
    const estab = apenasDigitos(cnpjEstabelecimento);
    if (estab.length !== 14) return false;
    const raizEstab = estab.slice(0, 8);
    const blob = String(textoCert || '');
    const cnpjsNoCert = extrairCnpjsDoTexto(blob);
    if (cnpjsNoCert.some((c) => c === estab || c.slice(0, 8) === raizEstab)) return true;
    const soDigitos = blob.replace(/\D/g, '');
    return soDigitos.includes(estab) || soDigitos.includes(raizEstab);
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
        '        FriendlyName = $c.FriendlyName',
        '        SimpleName = $c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)',
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
            if (mensagemIndicaChaveNaoExportavel(msg)) {
                throw erroCertificadoNaoExportavel(msg);
            }
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
        '  $subj = ([string]$_.Subject) + " " + ([string]$_.FriendlyName)',
        '  $dig = $subj -replace "\\D",""',
        '  if ($subj -like ("*" + $cnpj + "*")) { return $true }',
        '  if ($dig.Contains($cnpj)) { return $true }',
        '  if ($raiz.Length -eq 8 -and $dig.Contains($raiz)) { return $true }',
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
        if (mensagemIndicaChaveNaoExportavel(msg)) {
            throw erroCertificadoNaoExportavel(msg);
        }
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
 * Busca arquivo .pfx configurado no .env ou na pasta Certificados/ (por CNPJ no nome).
 * @returns {{ pfx: Buffer, passphrase: string } | null}
 */
function tentarPfxDeArquivo(cnpj) {
    const pass = process.env[`SEFAZ_PFX_PASS_${cnpj}`] || process.env.SEFAZ_PFX_PASS || '';
    const paths = [];
    const envPath = process.env[`SEFAZ_PFX_PATH_${cnpj}`] || process.env.SEFAZ_PFX_PATH;
    if (envPath) paths.push(envPath);

    const dirCerts = path.join(ROOT, 'Certificados');
    if (fs.existsSync(dirCerts)) {
        const raiz = raizCnpj(cnpj);
        try {
            for (const nome of fs.readdirSync(dirCerts)) {
                if (!/\.pfx$/i.test(nome) && !/\.p12$/i.test(nome)) continue;
                const full = path.join(dirCerts, nome);
                const base = nome.replace(/\.(pfx|p12)$/i, '');
                const digitos = base.replace(/\D/g, '');
                if (digitos.includes(cnpj) || (raiz.length === 8 && digitos.includes(raiz))) {
                    paths.push(full);
                }
            }
        } catch (_e) { /* ignora */ }
    }

    for (const p of paths) {
        if (p && fs.existsSync(p)) {
            if (!pass) {
                console.warn(`[SEFAZ] PFX encontrado sem senha, ignorando (defina SEFAZ_PFX_PASS): ${p}`);
                continue;
            }
            return { pfx: fs.readFileSync(p), passphrase: pass };
        }
    }
    return null;
}

/**
 * Retorna { pfx, passphrase } para uso no node-mde.
 * Ordem: 1) .pfx em arquivo (.env / Certificados/)  2) thumbprint  3) export automático por CNPJ
 * @param {string} cnpj CNPJ extraído do DN (usado para fallback por CNPJ).
 * @param {string} [thumbprint] Certificado escolhido manualmente na UI.
 */
async function obterCredenciais(cnpj, thumbprint) {
    const pfxArquivo = tentarPfxDeArquivo(cnpj);
    if (pfxArquivo) {
        return pfxArquivo;
    }

    if (thumbprint) {
        try {
            return await exportarPfxPorThumbprint(thumbprint);
        } catch (errThumb) {
            if (mensagemIndicaChaveNaoExportavel(errThumb.message)) {
                throw erroCertificadoNaoExportavel(errThumb.message);
            }
            throw errThumb;
        }
    }

    try {
        return await exportarPfxPorCnpj(cnpj);
    } catch (errExport) {
        if (mensagemIndicaChaveNaoExportavel(errExport.message)) {
            throw erroCertificadoNaoExportavel(errExport.message);
        }
        const { lista } = await listarCertsPowerShell();
        const compativeis = lista.filter((c) =>
            certificadoCompativelComEstabelecimento(
                [c.Subject, c.FriendlyName, c.SimpleName].filter(Boolean).join(' '),
                cnpj
            )
        );
        const listaStr = compativeis.slice(0, 5)
            .map((c) => ` - [${c.Thumbprint}] ${c.Subject} (HasPrivateKey=${c.HasPrivateKey})`)
            .join('\n');
        const erro = new ErroCertificadoSefaz(
            `Não foi possível obter o certificado para o CNPJ ${cnpj}.`,
            {
                codigo: 'CERT_NAO_ENCONTRADO',
                permiteSelecaoManual: true,
                orientacao:
                    (compativeis.length > 0
                        ? `Certificados com esse CNPJ no Windows:\n${listaStr}\n\n`
                        : '') +
                    'Configure SEFAZ_PFX_PATH e SEFAZ_PFX_PASS no .env, ou selecione outro certificado.\n' +
                    `Detalhe: ${errExport.message}`,
            }
        );
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
 * SEFAZ informa cancelamento sem enviar XML (ex.: cStat 653 — arquivo indisponível para download).
 * Nesse caso a NF está cancelada; basta atualizar SITNFE no banco.
 */
function nfCanceladaNaRespostaSefaz(cStat, xMotivo) {
    const stat = String(cStat ?? '').trim();
    const motivo = String(xMotivo ?? '').toLowerCase();
    if (stat === '653') return true;
    if (/nf-?e\s+cancelad/i.test(motivo) || /nfe\s+cancelad/i.test(motivo)) return true;
    if (motivo.includes('cancelad') && motivo.includes('indisponivel')) return true;
    if (motivo.includes('cancelad') && motivo.includes('arquivo indisponivel')) return true;
    return false;
}

/** Executa consultaChNFe na SEFAZ (certificado igual ao fluxo de download de XML). */
async function consultarDistribuicaoPorChave(chave, dnCert, uf, opts = {}) {
    const { tpAmb = '1', thumbprint, tratarCanceladaSemDoc = false } = opts || {};
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
    const docs = resultado.data?.docZip || [];
    if (!docs.length) {
        if (tratarCanceladaSemDoc && nfCanceladaNaRespostaSefaz(cStat, xMotivo)) {
            return {
                chaveLimpa,
                cnpj,
                cStat,
                xMotivo,
                docs: [],
                canceladaSemDocumento: true,
            };
        }
        const prefixo = `Nenhum documento retornado pela SEFAZ (cStat=${cStat || '-'} ${xMotivo || ''}).`;
        if (nfCanceladaNaRespostaSefaz(cStat, xMotivo)) {
            throw new Error(`${prefixo} A NF-e está cancelada; o XML não está disponível para download.`);
        }
        throw new Error(
            `${prefixo} Verifique se a chave está correta e se o CNPJ do estabelecimento é o destinatário desta NF-e.`
        );
    }
    return { chaveLimpa, cnpj, cStat, xMotivo, docs, canceladaSemDocumento: false };
}

/** Percorre o XML parseado e coleta nós infEvento (cancelamento, etc.). */
function coletarInfEventos(obj, lista = []) {
    if (!obj || typeof obj !== 'object') return lista;
    if (obj.tpEvento !== undefined && (obj.chNFe !== undefined || obj.detEvento !== undefined)) {
        lista.push(obj);
    }
    for (const chave of Object.keys(obj)) {
        const val = obj[chave];
        if (Array.isArray(val)) {
            val.forEach((item) => coletarInfEventos(item, lista));
        } else if (val && typeof val === 'object') {
            coletarInfEventos(val, lista);
        }
    }
    return lista;
}

const DESC_TP_EVENTO = {
    '110110': 'Carta de Correção',
    '110111': 'Cancelamento',
    '110112': 'Encerramento',
    '110140': 'EPEC',
    '111500': 'Pedido de Prorrogação 1º prazo',
    '111501': 'Pedido de Prorrogação 2º prazo',
    '210200': 'Confirmação da Operação pelo Destinatário',
    '210210': 'Ciência da Operação pelo Destinatário',
    '210220': 'Desconhecimento da Operação',
    '210240': 'Operação não Realizada',
};

function textoCampo(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return String(v['#text'] ?? v._text ?? '').trim();
    return String(v).trim();
}

function rotuloOrgaoSefaz(cOrgao) {
    const c = textoCampo(cOrgao);
    if (c === '91') return 'AN';
    return c;
}

function rotuloEventoSefaz(tpEvento, descXml) {
    const tp = textoCampo(tpEvento);
    return DESC_TP_EVENTO[tp] || textoCampo(descXml) || (tp ? `Evento ${tp}` : 'Evento');
}

function rotuloAmbienteSefaz(tpAmb) {
    const a = textoCampo(tpAmb);
    if (a === '1') return 'produção';
    if (a === '2') return 'homologação';
    return a || '';
}

function comoLista(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

function eventoDeProcEvento(proc) {
    if (!proc || typeof proc !== 'object') return null;
    const inf = proc.evento?.infEvento || proc.infEvento || {};
    const ret = proc.retEvento?.infEvento || {};
    const det = inf.detEvento || {};
    const tp = textoCampo(inf.tpEvento || ret.tpEvento);
    if (!tp) return null;
    const cOrgao = textoCampo(ret.cOrgao || inf.cOrgao);
    const orgao = rotuloOrgaoSefaz(cOrgao);
    let descricao = rotuloEventoSefaz(tp, det.descEvento);
    if (orgao) descricao += ` (Órgão Autor: ${orgao})`;
    return {
        tpEvento: tp,
        nSeqEvento: Number(textoCampo(inf.nSeqEvento || ret.nSeqEvento) || 1) || 1,
        descricao,
        protocolo: textoCampo(ret.nProt || inf.nProt),
        dhEvento: textoCampo(inf.dhEvento),
        dhRegEvento: textoCampo(ret.dhRegEvento),
        orgao,
        cOrgao,
        xCorrecao: textoCampo(det.xCorrecao),
    };
}

function xmlDocParaTexto(xml) {
    if (xml == null) return '';
    let buf = Buffer.isBuffer(xml) ? xml : null;
    if (!buf && typeof xml === 'string' && xml.charCodeAt(0) === 0x1f) {
        buf = Buffer.from(xml, 'binary');
    }
    if (!buf && typeof xml === 'string' && xml.trim() && !xml.trim().startsWith('<')) {
        try {
            const b64 = Buffer.from(xml.replace(/\s+/g, ''), 'base64');
            if (b64.length > 2 && ((b64[0] === 0x1f && b64[1] === 0x8b) || b64.toString('utf8').trim().startsWith('<'))) {
                buf = b64;
            }
        } catch (_e) { /* não é base64 */ }
    }
    if (buf && buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        try { return zlib.gunzipSync(buf).toString('utf8'); } catch (_e) { /* mantém */ }
    }
    if (buf) return buf.toString('utf8');
    return String(xml);
}

function expandirXmlAninhado(obj, profundidade = 0) {
    if (!obj || typeof obj !== 'object' || profundidade > 12) return obj;
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.includes('<') && /retConsSitNFe|procEventoNFe|infEvento|protNFe/.test(v)) {
            try {
                const txt = v
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&');
                obj[k] = parserStatusXml.parse(txt);
            } catch (_e) { /* mantém string */ }
        }
        if (obj[k] && typeof obj[k] === 'object') expandirXmlAninhado(obj[k], profundidade + 1);
    }
    return obj;
}

function nomeLocalTag(chave) {
    const s = String(chave || '');
    return s.includes(':') ? s.split(':').pop() : s.replace(/^_+/, '');
}

function coletarPorNomeLocal(obj, nomeAlvo, acc = []) {
    if (!obj || typeof obj !== 'object') return acc;
    for (const [k, v] of Object.entries(obj)) {
        if (nomeLocalTag(k) === nomeAlvo) {
            comoLista(v).forEach((item) => acc.push(item));
        }
        if (v && typeof v === 'object') coletarPorNomeLocal(v, nomeAlvo, acc);
    }
    return acc;
}

function mergeEventoParcial(prev, partial) {
    const base = prev || {};
    return {
        tpEvento: partial.tpEvento || base.tpEvento,
        nSeqEvento: partial.nSeqEvento || base.nSeqEvento || 1,
        descricao: partial.descricao && !String(partial.descricao).startsWith('Evento ')
            ? partial.descricao
            : (base.descricao || partial.descricao || ''),
        protocolo: partial.protocolo || base.protocolo || '',
        dhEvento: partial.dhEvento || base.dhEvento || '',
        dhRegEvento: partial.dhRegEvento || base.dhRegEvento || '',
        orgao: partial.orgao || base.orgao || '',
        cOrgao: partial.cOrgao || base.cOrgao || '',
        xCorrecao: partial.xCorrecao || base.xCorrecao || '',
    };
}

function eventoDeInfEvento(inf) {
    if (!inf || typeof inf !== 'object') return null;
    const det = inf.detEvento || {};
    const tp = textoCampo(inf.tpEvento);
    if (!tp) return null;
    const cOrgao = textoCampo(inf.cOrgao);
    const orgao = rotuloOrgaoSefaz(cOrgao);
    let descricao = rotuloEventoSefaz(tp, det.descEvento);
    if (orgao) descricao += ` (Órgão Autor: ${orgao})`;
    return {
        tpEvento: tp,
        nSeqEvento: Number(textoCampo(inf.nSeqEvento) || 1) || 1,
        descricao,
        protocolo: textoCampo(inf.nProt),
        dhEvento: textoCampo(inf.dhEvento),
        dhRegEvento: textoCampo(inf.dhRegEvento),
        orgao,
        cOrgao,
        xCorrecao: textoCampo(det.xCorrecao),
    };
}

function coletarEventosDeObjeto(obj, registrar, setAmbiente) {
    if (!obj || typeof obj !== 'object') return;
    expandirXmlAninhado(obj);

    const infProts = coletarPorNomeLocal(obj, 'infProt');
    for (const infProt of infProts) {
            if (textoCampo(infProt.nProt) && textoCampo(infProt.cStat) !== '101') {
            setAmbiente(rotuloAmbienteSefaz(infProt.tpAmb));
            registrar({
                tpEvento: 'autorizacao',
                nSeqEvento: 0,
                descricao: 'Autorização de Uso',
                protocolo: textoCampo(infProt.nProt),
                dhEvento: textoCampo(infProt.dhRecbto),
                dhRegEvento: textoCampo(infProt.dhRecbto),
                orgao: rotuloOrgaoSefaz(infProt.cOrgao),
                cOrgao: textoCampo(infProt.cOrgao),
                xCorrecao: '',
            }, true);
        }
    }

    const procs = [
        ...coletarPorNomeLocal(obj, 'procEventoNFe'),
        ...coletarPorNomeLocal(obj, 'procEvento'),
        ...coletarPorNomeLocal(obj, 'resEvento'),
    ];
    for (const proc of procs) {
        const ev = eventoDeProcEvento(proc) || eventoDeInfEvento(proc.infEvento || proc);
        if (ev) registrar(ev);
    }

    for (const inf of coletarInfEventos(obj)) {
        const ev = eventoDeInfEvento(inf);
        if (ev && ev.tpEvento !== 'autorizacao') registrar(ev);
    }
}

/**
 * Monta a lista de eventos da NF-e (autorização + procEventoNFe) a partir dos docs da Dist DFe / Consulta Protocolo.
 */
function extrairEventosSefaz(docs) {
    const mapa = new Map();
    let ambiente = '';
    let autorizacao = null;

    const registrar = (ev, ehAutorizacao = false) => {
        if (!ev || !ev.tpEvento) return;
        if (ehAutorizacao || ev.tpEvento === 'autorizacao') {
            autorizacao = mergeEventoParcial(autorizacao, { ...ev, tpEvento: 'autorizacao', nSeqEvento: 0, descricao: 'Autorização de Uso' });
            return;
        }
        const chaveEv = `${ev.tpEvento}|${ev.nSeqEvento || 1}`;
        mapa.set(chaveEv, mergeEventoParcial(mapa.get(chaveEv), ev));
    };
    const setAmbiente = (amb) => {
        if (amb && !ambiente) ambiente = amb;
    };

    for (const doc of docs || []) {
        if (doc && typeof doc === 'object' && doc.json) {
            coletarEventosDeObjeto(doc.json, registrar, setAmbiente);
        }
        const xml = xmlDocParaTexto(doc && doc.xml);
        if (xml) {
            try {
                coletarEventosDeObjeto(parserStatusXml.parse(xml), registrar, setAmbiente);
            } catch (_e) { /* ignora xml inválido */ }
            const blocos = xml.match(/<(?:[\w.-]+:)?procEventoNFe\b[\s\S]*?<\/(?:[\w.-]+:)?procEventoNFe>/gi) || [];
            for (const bloco of blocos) {
                try {
                    coletarEventosDeObjeto(parserStatusXml.parse(bloco), registrar, setAmbiente);
                } catch (_e) { /* ignora bloco inválido */ }
            }
        }
        if (doc && typeof doc === 'object' && !doc.xml && !doc.json) {
            coletarEventosDeObjeto(doc, registrar, setAmbiente);
        }
    }

    const eventos = [];
    if (autorizacao) eventos.push(autorizacao);
    for (const ev of mapa.values()) eventos.push(ev);
    eventos.sort((a, b) => String(a.dhEvento || '').localeCompare(String(b.dhEvento || '')));
    const temCce = eventos.some((e) => e.tpEvento === '110110');
    return { eventos, ambiente, temCce };
}

function urlConsultaProtocolo(chave, tpAmb) {
    const cUF = String(chave || '').replace(/\D/g, '').slice(0, 2);
    if (String(tpAmb) === '2') {
        if (['11', '12', '14', '16', '17', '22', '24', '25', '27', '28', '32', '33', '42', '53'].includes(cUF)) {
            return SVRS_CONSULTA_PROT_HOM;
        }
    }
    return MAP_CONSULTA_PROTOCOLO[cUF] || SVRS_CONSULTA_PROT;
}

function urlConsultaCte(chave, tpAmb) {
    const cUF = String(chave || '').replace(/\D/g, '').slice(0, 2);
    if (String(tpAmb) === '2') {
        if (['11', '12', '14', '16', '17', '22', '24', '25', '27', '28', '32', '33', '42', '53'].includes(cUF)) {
            return SVRS_CTE_CONSULTA_HOM;
        }
    }
    return MAP_CTE_CONSULTA[cUF] || SVRS_CTE_CONSULTA;
}

function envelopesConsultaCte(chave, tpAmb) {
    const cUF = String(chave || '').replace(/\D/g, '').slice(0, 2);
    const cons =
        `<consSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">` +
        `<tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chCTe>${chave}</chCTe></consSitCTe>`;
    const ns = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeConsultaV4';
    const soapAction = `${ns}/cteConsultaCT`;
    const cabec = `<cteCabecMsg xmlns="${ns}"><cUF>${cUF}</cUF><versaoDados>4.00</versaoDados></cteCabecMsg>`;
    return [
        {
            body:
                `<?xml version="1.0" encoding="utf-8"?>` +
                `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
                `<soap12:Header>${cabec}</soap12:Header>` +
                `<soap12:Body><cteDadosMsg xmlns="${ns}">${cons}</cteDadosMsg></soap12:Body></soap12:Envelope>`,
            headers: {
                'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
                SOAPAction: `"${soapAction}"`,
            },
        },
        {
            body:
                `<?xml version="1.0" encoding="utf-8"?>` +
                `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cte="${ns}">` +
                `<soap:Header>${cabec}</soap:Header>` +
                `<soap:Body><cte:cteDadosMsg>${cons}</cte:cteDadosMsg></soap:Body></soap:Envelope>`,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                SOAPAction: `"${soapAction}"`,
            },
        },
    ];
}

function extrairBlocoXmlPorTag(xml, tagLocal) {
    const re = new RegExp(`<(?:[\\w.-]+:)?${tagLocal}\\b[\\s\\S]*?<\\/(?:[\\w.-]+:)?${tagLocal}>`, 'i');
    const m = String(xml || '').match(re);
    return m ? m[0] : '';
}

function dadosDeRetConsultaSitCte(xmlResp, parsed, chaveInformada) {
    const ret = coletarPorNomeLocal(parsed, 'retConsSitCTe')[0] || {};
    const cStatRet = textoCampo(ret.cStat);
    const xMotivoRet = textoCampo(ret.xMotivo);
    if (cStatRet && !CSTAT_CONSULTA_CTE_OK.includes(cStatRet)) {
        throw new Error(xMotivoRet ? `SEFAZ CT-e (${cStatRet}): ${xMotivoRet}` : `SEFAZ CT-e cStat ${cStatRet}.`);
    }

    const blocoProc = extrairBlocoXmlPorTag(xmlResp, 'procCTe');
    if (blocoProc && /infCte|infCTe/i.test(blocoProc)) {
        const dados = parsearXmlCte(blocoProc);
        if (!dados.chave) dados.chave = chaveInformada;
        return dados;
    }

    const infProt = coletarPorNomeLocal(parsed, 'infProt')[0] || {};
    const cStat = textoCampo(infProt.cStat) || cStatRet;
    const xMotivo = textoCampo(infProt.xMotivo) || xMotivoRet;
    const sit = situacaoCtePorCstat(cStat, xMotivo);
    const chave = textoCampo(infProt.chCTe).replace(/\D/g, '') || chaveInformada;
    const xmlGravacao = extrairBlocoXmlPorTag(xmlResp, 'retConsSitCTe') || String(xmlResp || '');
    return {
        xml: xmlGravacao,
        chave,
        nct: '',
        serie: '',
        cnpjEmitente: '',
        nomeEmitente: '',
        vTPrest: '',
        dhEmi: '',
        situacao: sit.situacao,
        situacaoLabel: sit.situacaoLabel,
        cStat,
        xMotivo,
        ambiente: rotuloAmbienteSefaz(ret.tpAmb || infProt.tpAmb),
        chavesNfe: chavesNfeNoXmlCte(xmlGravacao, parsed),
    };
}

function envelopesConsultaProtocolo(chave, tpAmb) {
    const cons =
        `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;
    const soapAction = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF';
    return [
        {
            body:
                `<?xml version="1.0" encoding="utf-8"?>` +
                `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
                `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">${cons}</nfeDadosMsg></soap12:Body></soap12:Envelope>`,
            headers: {
                'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
                SOAPAction: `"${soapAction}"`,
            },
        },
        {
            body:
                `<?xml version="1.0" encoding="utf-8"?>` +
                `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">` +
                `<soap:Body><nfe:nfeDadosMsg>${cons}</nfe:nfeDadosMsg></soap:Body></soap:Envelope>`,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                SOAPAction: `"${soapAction}"`,
            },
        },
    ];
}

async function postConsultaProtocolo(url, envelope, headers, agent) {
    const resp = await axios.post(url, envelope, {
        httpsAgent: agent,
        timeout: 60000,
        responseType: 'text',
        transformResponse: [(d) => d],
        headers,
        validateStatus: () => true,
    });
    const xmlResp = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    return { status: resp.status, xmlResp };
}

/**
 * Consulta Protocolo (nfeConsultaNF) — é o webservice do portal que devolve todos os eventos.
 */
async function consultarEventosPorProtocolo(chave, dnCert, opts = {}) {
    const tpAmb = opts.tpAmb || '1';
    const cnpj = extrairCnpjDoDN(dnCert);
    const cred = await obterCredenciais(cnpj, opts.thumbprint);
    const url = urlConsultaProtocolo(chave, tpAmb);
    const agent = new https.Agent({
        pfx: cred.pfx,
        passphrase: cred.passphrase || '',
        rejectUnauthorized: false,
    });

    let ultimoErro = null;
    for (const env of envelopesConsultaProtocolo(chave, tpAmb)) {
        try {
            const { status, xmlResp } = await postConsultaProtocolo(url, env.body, env.headers, agent);
            if (status >= 400) {
                ultimoErro = new Error(`Consulta protocolo HTTP ${status}`);
                continue;
            }
            if (!xmlResp || /<\s*html[\s>]/i.test(xmlResp)) {
                ultimoErro = new Error('Consulta protocolo retornou HTML em vez de XML');
                continue;
            }
            const parsed = parserStatusXml.parse(xmlResp);
            expandirXmlAninhado(parsed);
            const extra = extrairEventosSefaz([{ json: parsed, xml: xmlResp }]);
            const rets = coletarPorNomeLocal(parsed, 'retConsSitNFe');
            const cStatRet = textoCampo((rets[0] || {}).cStat);
            if (!rets.length && extra.eventos.length === 0) {
                ultimoErro = new Error('Consulta protocolo sem retConsSitNFe');
                continue;
            }
            if (cStatRet && !['100', '101', '110', '150', '151', '155'].includes(cStatRet) && extra.eventos.length <= 1) {
                console.warn(`[SEFAZ consulta protocolo] cStat=${cStatRet} url=${url}`);
            }
            console.log(`[SEFAZ consulta protocolo] cStat=${cStatRet || '-'} eventos=${extra.eventos.length} url=${url}`);
            return extra;
        } catch (err) {
            ultimoErro = err;
        }
    }
    throw ultimoErro || new Error('Falha na consulta de protocolo da NF-e');
}

function mesclarExtraEventos(base, extra) {
    const mapa = new Map();
    let autorizacao = null;
    const ambiente = (extra && extra.ambiente) || (base && base.ambiente) || '';
    const push = (ev) => {
        if (!ev || !ev.tpEvento) return;
        if (ev.tpEvento === 'autorizacao') {
            autorizacao = mergeEventoParcial(autorizacao, ev);
            return;
        }
        const k = `${ev.tpEvento}|${ev.nSeqEvento || 1}`;
        mapa.set(k, mergeEventoParcial(mapa.get(k), ev));
    };
    for (const ev of (base && base.eventos) || []) push(ev);
    for (const ev of (extra && extra.eventos) || []) push(ev);
    const eventos = [];
    if (autorizacao) eventos.push(autorizacao);
    for (const ev of mapa.values()) eventos.push(ev);
    eventos.sort((a, b) => String(a.dhEvento || a.dhRegEvento || '').localeCompare(String(b.dhEvento || b.dhRegEvento || '')));
    return {
        eventos,
        ambiente,
        temCce: eventos.some((e) => e.tpEvento === '110110') || Boolean(base?.temCce) || Boolean(extra?.temCce),
    };
}

/**
 * Interpreta documentos retornados pela Distribuição DFe (resNFe, procNFe, eventos).
 * Situação "cancelada" quando cSitNFe=3 ou evento tpEvento 110111 (cancelamento homologado).
 */
function analisarSituacaoNFeSefaz(docs, cStat, xMotivo) {
    let cancelada = false;
    let denegada = false;
    let autorizada = false;
    const detalhes = [];

    for (const doc of docs || []) {
        const xml = doc.xml;
        if (!xml) continue;
        let obj;
        try {
            obj = parserStatusXml.parse(xml);
        } catch (_e) {
            continue;
        }

        const resNFe = obj.resNFe;
        if (resNFe) {
            const sit = String(resNFe.cSitNFe ?? '').trim();
            if (sit === '3') {
                cancelada = true;
                detalhes.push('resNFe: cSitNFe=3 (Cancelada)');
            } else if (sit === '2') {
                denegada = true;
                detalhes.push('resNFe: cSitNFe=2 (Denegada)');
            } else if (sit === '1') {
                autorizada = true;
                detalhes.push('resNFe: cSitNFe=1 (Autorizada)');
            }
        }

        const prot = obj.nfeProc?.protNFe?.infProt || obj.protNFe?.infProt;
        if (prot) {
            const cStatProt = String(prot.cStat ?? '').trim();
            if (cStatProt === '100' && !cancelada) {
                autorizada = true;
                detalhes.push('protNFe: cStat=100 (Uso autorizado)');
            }
            if (cStatProt === '101') {
                cancelada = true;
                detalhes.push('protNFe: cStat=101 (Cancelamento homologado)');
            }
        }

        for (const ev of coletarInfEventos(obj)) {
            const tp = String(ev.tpEvento ?? '').trim();
            if (tp === '110111') {
                cancelada = true;
                detalhes.push('Evento tpEvento=110111 (Cancelamento de NF-e)');
            }
        }
    }

    let situacao = 'indefinida';
    let label = 'Indefinida';
    if (cancelada) {
        situacao = 'cancelada';
        label = 'Cancelado';
    } else if (denegada) {
        situacao = 'denegada';
        label = 'Denegado';
    } else if (autorizada) {
        situacao = 'autorizada';
        label = 'Autorizado';
    }

    return {
        situacao,
        label,
        cancelada,
        denegada,
        autorizada,
        detalhe: detalhes.join('; ') || null,
        cStat: cStat != null ? String(cStat) : null,
        xMotivo: xMotivo != null ? String(xMotivo) : null,
    };
}

/**
 * Consulta o XML de uma NF-e na SEFAZ a partir da chave.
 * @param {string} chave   44 dígitos
 * @param {string} dnCert  valor de ESTAB.CERTIFICADO_NFE
 * @param {string} uf      sigla da UF do estabelecimento
 * @param {object} [opts]  { tpAmb, thumbprint }
 */
async function statusAposDistribuicao(dist, dnCert, opts = {}) {
    const { chaveLimpa, cnpj, cStat, xMotivo, docs, canceladaSemDocumento } = dist;
    if (canceladaSemDocumento) {
        return {
            chave: chaveLimpa,
            cnpj,
            situacao: 'cancelada',
            label: 'Cancelado',
            cancelada: true,
            denegada: false,
            autorizada: false,
            detalhe: `SEFAZ cStat=${cStat || '-'}: ${xMotivo || 'NF-e cancelada (sem XML na distribuição)'}`,
            cStat: cStat != null ? String(cStat) : null,
            xMotivo: xMotivo != null ? String(xMotivo) : null,
            origemDeteccao: 'resposta_sefaz_653',
            eventos: [],
            ambiente: '',
            temCce: false,
        };
    }

    const analise = analisarSituacaoNFeSefaz(docs, cStat, xMotivo);
    let extra = extrairEventosSefaz(docs);
    try {
        extra = mesclarExtraEventos(extra, await consultarEventosPorProtocolo(chaveLimpa, dnCert, opts));
        if (extra.eventos.some((e) => String(e.tpEvento) === '110111')) {
            analise.situacao = 'cancelada';
            analise.label = 'Cancelado';
            analise.cancelada = true;
            analise.autorizada = false;
        }
    } catch (errProt) {
        console.warn('[SEFAZ consulta protocolo]', errProt?.message || errProt);
    }
    return {
        chave: chaveLimpa,
        cnpj,
        ...analise,
        origemDeteccao: 'documento_distribuicao',
        eventos: extra.eventos,
        ambiente: extra.ambiente,
        temCce: extra.temCce,
    };
}

async function consultarXmlPorChave(chave, dnCert, uf, opts = {}) {
    const dist = await consultarDistribuicaoPorChave(chave, dnCert, uf, opts);
    const doc = dist.docs.find((d) => String(d.schema || '').startsWith('procNFe'))
        || dist.docs.find((d) => String(d.schema || '').startsWith('resNFe'))
        || dist.docs[0];
    const statusSefaz = await statusAposDistribuicao(dist, dnCert, opts);
    return { xml: doc.xml, cnpj: dist.cnpj, schema: doc.schema, statusSefaz };
}

/**
 * Consulta a situação da NF-e na SEFAZ (Distribuição DFe por chave).
 * Usa o mesmo certificado/estabelecimento do download de XML.
 */
async function consultarStatusPorChave(chave, dnCert, uf, opts = {}) {
    const dist = await consultarDistribuicaoPorChave(chave, dnCert, uf, { ...opts, tratarCanceladaSemDoc: true });
    return statusAposDistribuicao(dist, dnCert, opts);
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
        const textos = [c.Subject, c.FriendlyName, c.SimpleName].filter(Boolean).join(' | ');
        const cnpjs = extrairCnpjsDoTexto(textos);
        return {
            thumbprint: c.Thumbprint,
            nome: extrairCN(c.Subject) || c.FriendlyName || c.SimpleName || '',
            subject: c.Subject,
            friendlyName: c.FriendlyName || '',
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

function modeloDaChave(chave) {
    return String(chave || '').replace(/\D/g, '').slice(20, 22);
}

function ehChaveCte(chave) {
    const mod = modeloDaChave(chave);
    return mod === '57' || mod === '67';
}

function codigoUfAutor(uf, chaveRef) {
    const s = String(uf || '').trim().toUpperCase();
    if (/^\d{2}$/.test(s)) return s;
    if (MAP_UF[s]) return MAP_UF[s];
    const cUF = String(chaveRef || '').replace(/\D/g, '').slice(0, 2);
    return /^\d{2}$/.test(cUF) ? cUF : '35';
}

function situacaoCtePorCstat(cStat, xMotivo) {
    const c = String(cStat || '');
    if (['100', '150'].includes(c)) return { situacao: 'autorizado', situacaoLabel: 'Autorizado' };
    if (['101', '151', '155'].includes(c)) return { situacao: 'cancelado', situacaoLabel: 'Cancelado' };
    if (['110', '301', '302', '303'].includes(c)) return { situacao: 'denegado', situacaoLabel: 'Denegado' };
    if (!c) return { situacao: 'desconhecida', situacaoLabel: xMotivo || 'Consultado' };
    return { situacao: 'outro', situacaoLabel: xMotivo || `cStat ${c}` };
}

function extrairChavesCteDeXmlNfe(xml, chaveNfe) {
    const texto = String(xml || '');
    const nfe = String(chaveNfe || '').replace(/\D/g, '');
    const achadas = new Set();
    const re = /\d{44}/g;
    let m;
    while ((m = re.exec(texto))) {
        const ch = m[0];
        if (ch !== nfe && ehChaveCte(ch)) achadas.add(ch);
    }
    return [...achadas];
}

function chavesNfeNoXmlCte(xml, parsed) {
    const chaves = new Set();
    const infNFes = coletarPorNomeLocal(parsed, 'infNFe');
    for (const n of infNFes) {
        const ch = textoCampo(n && (n.chave || n.chNFe || n.chNfe)).replace(/\D/g, '');
        if (ch.length === 44 && modeloDaChave(ch) === '55') chaves.add(ch);
    }
    const re = /\d{44}/g;
    let m;
    const texto = String(xml || '');
    while ((m = re.exec(texto))) {
        if (modeloDaChave(m[0]) === '55') chaves.add(m[0]);
    }
    return [...chaves];
}

function parsearXmlCte(xml) {
    const parsed = parserStatusXml.parse(String(xml || ''));
    const infs = coletarPorNomeLocal(parsed, 'infCte').concat(coletarPorNomeLocal(parsed, 'infCTe'));
    const inf = infs[0] || {};
    const ide = inf.ide || {};
    const emit = inf.emit || {};
    const vPrest = inf.vPrest || {};
    const infProt = coletarPorNomeLocal(parsed, 'infProt')[0] || {};
    const idInf = textoCampo(inf._Id || inf.Id || inf._id).replace(/\D/g, '');
    const chave = (idInf.length === 44 ? idInf : textoCampo(infProt.chCTe).replace(/\D/g, '')) || '';
    const cStat = textoCampo(infProt.cStat);
    const xMotivo = textoCampo(infProt.xMotivo);
    const sit = situacaoCtePorCstat(cStat, xMotivo);
    const cnpjEmit = textoCampo(emit.CNPJ || emit.CPF).replace(/\D/g, '');
    return {
        xml: String(xml || ''),
        chave,
        nct: textoCampo(ide.nCT || ide.nCTe),
        serie: textoCampo(ide.serie),
        cnpjEmitente: cnpjEmit,
        nomeEmitente: textoCampo(emit.xNome),
        vTPrest: textoCampo(vPrest.vTPrest),
        dhEmi: textoCampo(ide.dhEmi),
        situacao: sit.situacao,
        situacaoLabel: sit.situacaoLabel,
        cStat,
        xMotivo,
        ambiente: rotuloAmbienteSefaz(ide.tpAmb || infProt.tpAmb),
        chavesNfe: chavesNfeNoXmlCte(xml, parsed),
    };
}

/**
 * Consulta situação do CT-e (modelo 57/67) via CTeConsultaV4 (consSitCTe).
 * A Distribuição DFe nacional (distDFeInt 1.00) não aceita consChCTe no schema — gerava rejeição 215.
 */
async function consultarXmlCtePorChave(chaveCte, dnCert, uf, opts = {}) {
    const chave = String(chaveCte || '').replace(/\D/g, '');
    if (chave.length !== 44) {
        throw new Error('Chave do CT-e inválida. Informe os 44 dígitos.');
    }
    if (!ehChaveCte(chave)) {
        throw new Error(`A chave informada não é de CT-e (modelo 57 ou 67). Modelo encontrado: ${modeloDaChave(chave) || '-'}.`);
    }
    const tpAmb = String(opts.tpAmb || process.env.SEFAZ_TPAMB || '1');
    const cnpj = extrairCnpjDoDN(dnCert);
    const cred = await obterCredenciais(cnpj, opts.thumbprint);
    const agent = new https.Agent({
        pfx: cred.pfx,
        passphrase: cred.passphrase || '',
        rejectUnauthorized: false,
    });
    const url = urlConsultaCte(chave, tpAmb);

    let ultimoErro = null;
    for (const env of envelopesConsultaCte(chave, tpAmb)) {
        try {
            const { status, xmlResp } = await postConsultaProtocolo(url, env.body, env.headers, agent);
            if (status >= 400) {
                ultimoErro = new Error(`Consulta CT-e HTTP ${status}`);
                continue;
            }
            if (!xmlResp || /<\s*html[\s>]/i.test(xmlResp)) {
                ultimoErro = new Error('Consulta CT-e retornou HTML em vez de XML.');
                continue;
            }
            const parsed = parserStatusXml.parse(xmlResp);
            expandirXmlAninhado(parsed);
            const rets = coletarPorNomeLocal(parsed, 'retConsSitCTe');
            if (!rets.length) {
                ultimoErro = new Error('Consulta CT-e sem retConsSitCTe na resposta.');
                continue;
            }
            const dados = dadosDeRetConsultaSitCte(xmlResp, parsed, chave);
            console.log(`[SEFAZ CT-e] cStat=${dados.cStat || '-'} chave=${dados.chave} url=${url}`);
            return dados;
        } catch (err) {
            if (err && /SEFAZ CT-e/.test(err.message)) throw err;
            ultimoErro = err;
        }
    }
    throw ultimoErro || new Error('Falha ao consultar o CT-e na SEFAZ.');
}

/** Formata erro de certificado/SEFAZ para resposta HTTP da API. */
function formatarErroRespostaSefaz(error) {
    if (error instanceof ErroCertificadoSefaz) {
        return {
            status: 500,
            body: {
                erro: error.message,
                codigo: error.codigo,
                orientacao: error.orientacao,
                permiteSelecaoManual: error.permiteSelecaoManual,
            },
        };
    }
    return {
        status: 500,
        body: {
            erro: error?.message || 'Falha na operação SEFAZ.',
            permiteSelecaoManual: Boolean(error?.permiteSelecaoManual),
        },
    };
}

module.exports = {
    raizCnpj,
    certificadoCompativelComEstabelecimento,
    extrairCnpjsDoTexto,
    consultarXmlPorChave,
    consultarXmlCtePorChave,
    parsearXmlCte,
    extrairChavesCteDeXmlNfe,
    ehChaveCte,
    consultarStatusPorChave,
    analisarSituacaoNFeSefaz,
    extrairEventosSefaz,
    nfCanceladaNaRespostaSefaz,
    extrairCnpjDoDN,
    diagnosticarCertificados,
    listarCertificadosParaUI,
    formatarErroRespostaSefaz,
    ErroCertificadoSefaz,
    MAP_UF,
};
