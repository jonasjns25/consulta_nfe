# Releases automáticos (GitHub Actions)

Ao dar **push** na branch **`main`**, o workflow **`.github/workflows/auto-release.yml`**:

1. Aumenta o **patch** da versão em `package.json` (ex.: 1.0.0 → 1.0.1).
2. Gera **`dist/consulta_nfe.zip`** com os arquivos listados em **`scripts/release-manifest.json`** (segurança: sem `.env` / certificado no pacote — veja `scripts/pack-release.cjs`).
3. Faz um commit automático na `main`: mensagem `ci(release): vX.Y.Z [release-bot]` (para não rodar em loop).
4. Cria uma **GitHub Release** com tag **`vX.Y.Z`** anexando o ZIP.

Os clientes com `UPDATE_REPO_OWNER` / `UPDATE_REPO_NAME` apontados para esse repositório passam a enxergar a nova **`releases/latest`**.

### Uso dia a dia

```text
alterações → commit → git push origin main
```

Opcionalmente ajuste a branch acionada no YAML se não for `main`.

### Empacotar só localmente

```powershell
npm run release:pack
```

Ou o PowerShell **`gerar_release.ps1`** (bump opcional / publicação com `gh`).

### Observações

- Se o último workflow falhou após já ter empurrado o commit `[release-bot]`, pode ficar inconsistência manual — corrija com uma nova mudança em `main` ou rode o workflow manualmente no GitHub com **workflow_dispatch** (pode acrescentar se quiser esse gatilho).
- Releases antigas ficam disponíveis; o updater usa apenas a **latest** compatível com semver.
