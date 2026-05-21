# Segurança — Consulta NF-e

Este documento descreve o tratamento de dados sensíveis e o comportamento das atualizações automáticas.

## Arquivo `.env` do cliente

- O arquivo **`.env` na pasta de instalação do servidor não é substituído** pelo atualizador ao aplicar uma release (ZIP).
- Igualmente **não serão escritos pelo ZIP**, na instalação do cliente:
  - qualquer arquivo cujo nome **começe por `.env`** ou **termine em `.env`** (ex.: `producao.env`);
  - `config.env`, `credentials.json` e derivados típicos;
  - certificados e chaves (`.pfx`, `.p12`, `.pem`, `.key`, `.jks`, etc.);
  - conteúdo sob a pasta **`Certificados/`** (não sobrescreve pela release).
- São preservados também: `node_modules`, `logs`, `backups`, etc. (lista no código em `updater.js`).

**Recomendação:** use apenas **`env.sample`** no repositório / no ZIP público como modelo; copie para `.env` no servidor com permissões restritas.

## Repositório Git e releases

- **Nunca** faça commit de `.env`, certificados (`.pfx`, `.p12`), `config.env` com senhas ou tokens em claro.
- Se algo sensível já foi enviado ao GitHub, **revogue/rode credenciais** (banco, DANFE, GitHub PAT, etc.) e, se necessário, use [remoção de dados sensíveis do histórico](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) ou contato com GitHub Support.
- Releases para clientes são montadas apenas com os caminhos de **`scripts/release-manifest.json`** (empacote `npm run release:pack`, script `gerar_release.ps1` ou **GitHub Actions** em push na `main`) — **sem** `.env`.

## GitHub Actions (release automática)

- Ver **`MANUAL_CI_RELEASE.md`**. O workflow sobe **patch** de versão e publica `consulta_nfe.zip` em **Releases**; o commit do bot contém `[release-bot]` para não disparar em loop.

## Tokens

- **`UPDATE_ADMIN_TOKEN`** (no `.env` do servidor): protege `POST /admin/atualizar`. Use valor longo e aleatório.
- **`UPDATE_TOKEN`** (GitHub): apenas se o repositório de releases for **privado**; permissão mínima (ex.: leitura de conteúdo).

## Auditoria rápida pós-deploy

1. Confirmar que `.env` local permanece igual após atualização automática (data de modificação, conteúdo).
2. `GET /admin/versao` — conferir versão instalada sem expor secrets.
