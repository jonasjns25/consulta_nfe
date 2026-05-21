# Solução para Erro "NotFound" na Consulta NF-e

## Problema
O erro "NotFound" indica que o aplicativo desktop não consegue se conectar ao servidor Node.js.

## Solução Rápida

### 1. Verificar se o servidor Node.js está rodando

Abra um terminal na pasta do projeto e execute:
```powershell
node server.js
```

Você deve ver uma mensagem como:
```
[INFO] Servidor rodando em http://localhost:3000
```

**IMPORTANTE:** Deixe esse terminal aberto enquanto usar o aplicativo desktop!

### 2. Verificar o arquivo config.env

O arquivo `config.env` deve estar na mesma pasta do executável `SACGerencial.exe`:

**Localização:** `SACGerencial\bin\Debug\net8.0-windows\config.env` (ou `Release`)

O arquivo deve conter:
```env
# Configurações do Banco de Dados
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=sac
DB_CONNECTION_LIMIT=5

# Configurações do Servidor API (Node.js)
API_HOST=localhost
PORT=3000

# Configurações da API DANFE
DANFE_API_KEY=bc045b03-cf17-488c-a03a-e0b716dfe377
DANFE_API_URL=https://api.meudanfe.com.br/v2
```

### 3. Se o servidor Node.js estiver em outro computador

Se o servidor Node.js estiver rodando em outro servidor (não localhost), altere no `config.env`:

```env
API_HOST=192.168.0.10  # IP do servidor onde está o Node.js
PORT=3000
```

### 4. Verificar se a porta está correta

A porta no `config.env` do desktop deve ser a **mesma** porta configurada no `.env` do servidor Node.js.

No `server.js`, a porta é definida por:
```javascript
const PORT = process.env.PORT || 3000;
```

Verifique o arquivo `.env` na raiz do projeto Node.js:
```env
PORT=3000
```

## Checklist de Diagnóstico

- [ ] Servidor Node.js está rodando? (`node server.js`)
- [ ] Arquivo `config.env` existe na pasta do executável?
- [ ] A porta no `config.env` está correta? (padrão: 3000)
- [ ] O `API_HOST` está correto? (localhost ou IP do servidor)
- [ ] O MySQL está acessível e o banco `sac` existe?
- [ ] O firewall não está bloqueando a porta?

## Teste Manual

Teste se o servidor está respondendo abrindo no navegador:
```
http://localhost:3000
```

Se aparecer a página HTML da consulta, o servidor está funcionando!

## Erros Comuns

### "Servidor não encontrado"
- Servidor Node.js não está rodando
- Porta incorreta no config.env
- Firewall bloqueando

### "Não foi possível conectar"
- Servidor Node.js não está rodando
- IP/host incorreto no API_HOST
- Rede/firewall bloqueando

### "Erro ao consultar NF-e: 500"
- Problema no banco de dados MySQL
- Verifique as credenciais no config.env
- Verifique se o banco `sac` existe

