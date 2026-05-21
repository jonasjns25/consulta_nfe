# Atualização Remota - Consulta NF-e

Este documento explica como o sistema se atualiza automaticamente nos clientes,
**sem necessidade de acesso manual a cada servidor**.

---

## Visão geral

```
┌──────────────────────┐
│  Você (desenvolvedor)│
│  gerar_release.ps1   │
└──────────┬───────────┘
           │ git push + gh release create
           ▼
┌──────────────────────┐
│   GitHub Releases    │  ←  versão "fonte da verdade"
│   (.zip + tag vX.Y.Z)│
└──────────┬───────────┘
           │ HTTPS (clientes puxam sozinhos)
           ▼
┌──────────────────────┐     ┌──────────────────────┐    ┌──────────────────────┐
│   Cliente A          │     │   Cliente B          │    │   Cliente C          │
│   ConsultaNFE.svc    │     │   ConsultaNFE.svc    │    │   ConsultaNFE.svc    │
│   (NSSM no Windows)  │     │   (NSSM no Windows)  │    │   (NSSM no Windows)  │
└──────────────────────┘     └──────────────────────┘    └──────────────────────┘
```

Cada cliente, ao iniciar o sistema e a cada `UPDATE_INTERVAL_H` horas (padrão 6h),
consulta a API do GitHub, descobre a release mais recente, compara com a versão
local e — se for mais nova — baixa, faz backup, aplica e reinicia o serviço.

---

## 1. Preparação única no GitHub (você faz uma vez)

1. Crie um repositório no GitHub (público ou privado). Exemplo: `minhaempresa/consulta_nfe`.
2. Faça o primeiro `git push` do projeto.
3. Se o repositório for **privado**, gere um Personal Access Token com escopo `repo`
   em https://github.com/settings/tokens e distribua junto com a instalação dos
   clientes (entra no `.env` como `UPDATE_TOKEN`).

---

## 2. Configuração no cliente (uma vez por servidor)

No `.env` de cada cliente:

```env
UPDATE_REPO_OWNER=minhaempresa
UPDATE_REPO_NAME=consulta_nfe
UPDATE_ASSET_NAME=consulta_nfe.zip
UPDATE_AUTO=true
UPDATE_INTERVAL_H=6
UPDATE_TOKEN=                     # só se o repo for privado
UPDATE_ADMIN_TOKEN=algumaCoisaLongaAleatoria   # opcional
```

Depois, ainda **como administrador**:

```cmd
instalar_servico.bat
```

Isso baixa o NSSM, registra o serviço **ConsultaNFE** no Windows e o coloca para
subir automaticamente na inicialização. O serviço também é configurado para
**reiniciar automaticamente** se o processo encerrar com o código `75` — código
que o `updater.js` emite após aplicar uma atualização.

---

## 3. Fluxo de release (você, no dia a dia)

Quando quiser empurrar uma nova versão para **todos os clientes**:

```powershell
# 1. Faça as alterações no código
# 2. Gere a release (incrementa patch automaticamente):
.\gerar_release.ps1 -Bump patch -Publicar

# Opções de bump:
#   -Bump patch  -> 1.0.0 -> 1.0.1   (correções)
#   -Bump minor  -> 1.0.0 -> 1.1.0   (features)
#   -Bump major  -> 1.0.0 -> 2.0.0   (mudanças incompatíveis)
```

O script:

1. Atualiza `package.json` com a nova versão.
2. Cria `dist/consulta_nfe.zip` com todos os arquivos necessários.
3. Commita, cria a tag `vX.Y.Z`, faz `git push --follow-tags`.
4. Cria a release no GitHub via `gh release create` anexando o `.zip`.

A partir desse momento, **todos os clientes vão pegar a nova versão** na próxima
verificação (no máximo `UPDATE_INTERVAL_H` horas depois, ou no próximo restart).

> **Pré-requisitos do `-Publicar`:** ter o [GitHub CLI](https://cli.github.com/) (`gh`)
> instalado e autenticado (`gh auth login`).

---

## 4. Como o updater funciona internamente

Ver `updater.js`. Resumidamente:

1. Lê `package.json` local → versão instalada.
2. `GET https://api.github.com/repos/{owner}/{repo}/releases/latest` → versão remota.
3. Se `semver.gt(remota, local)`:
   - Baixa o asset `.zip`.
   - Faz **backup** completo da instalação atual em `backups/<versao>_<timestamp>/`.
   - Extrai o `.zip` por cima dos arquivos, **preservando**:
     - `.env`
     - `node_modules/`
     - `logs/`
     - `backups/`
     - `.git/`, `.gitignore`
   - Roda `npm install --omit=dev` para pegar novas dependências.
   - Encerra o processo com exit code `75`.
4. NSSM detecta que o processo caiu com `75` e **reinicia o serviço** já com os
   arquivos novos.
5. Se algo der errado durante a extração, o backup é restaurado automaticamente.

---

## 5. Forçar atualização imediata em um cliente específico

### Modo A — pela tela do sistema (recomendado)

Ao abrir `http://localhost:3000/` (ou o IP do cliente), o sistema verifica a release
mais recente a cada 15 minutos. Quando há versão nova, aparece um banner no topo:

> **Nova versão disponível: vX.Y.Z** — versão atual `vA.B.C`
> [ Lembrar depois ] [ **Atualizar agora** ]

Clicar em **Atualizar agora** dispara o download/instalação, aguarda o serviço
reiniciar e recarrega a página automaticamente. Isso usa o endpoint
`POST /admin/atualizar`, que aceita por padrão requisições vindas de **IPs
internos da máquina/empresa**:

- loopback (`127.0.0.1`, `::1`);
- LAN privada: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`;
- link-local: `169.254.0.0/16`, `fe80::/10`.

Ou seja, qualquer estação dentro da rede do cliente pode usar o botão sem
saber/inserir token.

> Para **fechar** isso e exigir token sempre (inclusive na LAN), defina no `.env`:
> ```env
> UPDATE_REQUIRE_TOKEN=true
> UPDATE_ADMIN_TOKEN=algumaCoisaLongaAleatoria
> ```

### Modo B — no próprio servidor do cliente, pelo bat

Como admin no PowerShell/CMD:

```cmd
cd C:\consulta_nfe
atualizar_agora.bat
```

### Modo C — remotamente via HTTP (outra máquina)

Configure `UPDATE_ADMIN_TOKEN` no `.env` do cliente. Depois:

```bash
curl -X POST "http://IP_DO_CLIENTE:3000/admin/atualizar" \
     -H "X-Update-Token: seuTokenSecreto"
```

Para forçar (mesmo na mesma versão):

```bash
curl -X POST "http://IP_DO_CLIENTE:3000/admin/atualizar?force=true" \
     -H "X-Update-Token: seuTokenSecreto"
```

Consultar versão atual ou checar se há nova:

```bash
curl http://IP_DO_CLIENTE:3000/admin/versao
curl http://IP_DO_CLIENTE:3000/admin/verificar-atualizacao
```

---

## 6. Rollback (voltar uma versão)

Os backups ficam em `C:\consulta_nfe\backups\<versao>_<timestamp>\`.

Para reverter:

```cmd
net stop ConsultaNFE
xcopy /E /Y /I "C:\consulta_nfe\backups\1.2.0_2026-...\*" "C:\consulta_nfe\"
net start ConsultaNFE
```

> O `.env`, `node_modules` e `logs` **não** entram no backup (são preservados em
> ambos os lados), então o rollback é seguro.

---

## 7. Desabilitar auto-update em um cliente específico

No `.env` daquele cliente:

```env
UPDATE_AUTO=false
```

E reinicie o serviço (`net stop ConsultaNFE && net start ConsultaNFE`).
Ele continuará rodando normalmente, mas **não** verificará novas versões
automaticamente. Você ainda pode rodar `atualizar_agora.bat` manualmente.

---

## 8. Boas práticas

- **Sempre teste a release** em um cliente piloto antes de publicar para todos.
  Você pode manter um cliente com `UPDATE_AUTO=false` e atualizá-lo manualmente
  primeiro com `atualizar_agora.bat`.
- **Versione com cuidado:**
  - `patch` para fix
  - `minor` para feature compatível
  - `major` quando mudar estrutura do banco ou quebrar config
- **Use `UPDATE_ADMIN_TOKEN`** mesmo que não pretenda usar o endpoint hoje — fica
  pronto para emergências.
- **Monitore `logs/server.log`** dos clientes para ver as mensagens do updater.

---

## 9. Solução de problemas

| Sintoma                                                     | Causa provável                          | Solução                                            |
|-------------------------------------------------------------|-----------------------------------------|----------------------------------------------------|
| `HTTP 404` na verificação                                   | `UPDATE_REPO_OWNER/NAME` errado         | Conferir `.env` e existência da release            |
| `HTTP 401` na verificação                                   | Repo privado sem `UPDATE_TOKEN`         | Gerar token e adicionar no `.env`                  |
| Sistema reinicia em loop                                    | Update quebrou algo                     | Restaurar backup manualmente (seção 6)             |
| `npm install` falha após update                             | Sem internet ou nova dependência ausente| Rodar `npm install` manualmente como admin        |
| `Já está na versão mais recente` mas tem release nova       | Tag não-semver (ex: `release-2026-05`)  | Usar tags `vX.Y.Z`                                 |
| Serviço não reinicia após exit 75                           | NSSM não configurado corretamente       | Rodar `instalar_servico.bat` novamente             |

---

## 10. Checklist resumido

**No servidor central (você):**

- [ ] Repositório criado no GitHub
- [ ] Primeira release publicada (`v1.0.0`)
- [ ] `gh` CLI instalado e autenticado

**Em cada cliente:**

- [ ] `.env` configurado com `UPDATE_REPO_OWNER`/`UPDATE_REPO_NAME`
- [ ] Internet de saída liberada para `api.github.com` e `*.githubusercontent.com`
- [ ] `instalar_servico.bat` executado como admin
- [ ] Serviço `ConsultaNFE` aparece em `services.msc` como "Em execução"
- [ ] `http://localhost:3000/admin/versao` retorna a versão correta

A partir daí, **basta rodar `.\gerar_release.ps1 -Bump patch -Publicar` no seu
ambiente para atualizar todos os clientes**.
