# Guia de Instalação - Aplicativo Desktop Consulta NF-e

## Estrutura de Arquivos

Para rodar o aplicativo desktop em outro servidor, você precisa copiar **duas coisas**:

### 1. Aplicativo Desktop (C#)
Copie a pasta completa:
```
SACGerencial\bin\Debug\net8.0-windows\
```
ou
```
SACGerencial\bin\Release\net8.0-windows\
```

### 2. Servidor Node.js
Copie os seguintes arquivos da **raiz do projeto**:
- `server.js`
- `package.json`
- `package-lock.json` (se existir)
- `.env` ou `config.env` (com as configurações do MySQL)
- `index.html` e `detalhes.html` (opcional, mas recomendado)

## Instalação Passo a Passo

### No Servidor de Destino:

#### 1. Instalar Node.js
Baixe e instale o Node.js de: https://nodejs.org/
Versão recomendada: LTS (Long Term Support)

#### 2. Instalar .NET Runtime 8
Baixe e instale o .NET Runtime 8 de: https://dotnet.microsoft.com/download/dotnet/8.0
Escolha: **.NET Desktop Runtime 8.x** (para Windows)

#### 3. Copiar Arquivos do Servidor Node.js

Crie uma pasta, por exemplo: `C:\ConsultaNFE\Server\`

Copie para lá:
- `server.js`
- `package.json`
- `package-lock.json` (se existir)
- `.env` ou `config.env`

#### 4. Configurar o .env do Servidor

Edite o arquivo `.env` ou `config.env` na pasta do servidor:
```env
PORT=9000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=sua_senha
DB_NAME=sac
DB_CONNECTION_LIMIT=5
DANFE_API_KEY=bc045b03-cf17-488c-a03a-e0b716dfe377
DANFE_API_URL=https://api.meudanfe.com.br/v2
```

#### 5. Instalar Dependências do Node.js

Abra PowerShell na pasta do servidor e execute:
```powershell
cd C:\ConsultaNFE\Server
npm install
```

#### 6. Iniciar o Servidor Node.js

Execute:
```powershell
node server.js
```

Ou use o script:
```powershell
.\iniciar_servidor.bat
```

Você deve ver:
```
[INFO] Servidor rodando em http://localhost:9000
```

**IMPORTANTE:** Deixe esse terminal aberto enquanto usar o aplicativo desktop!

#### 7. Copiar Aplicativo Desktop

Copie a pasta `net8.0-windows` para o servidor, por exemplo:
```
C:\ConsultaNFE\Desktop\
```

#### 8. Configurar o config.env do Desktop

Edite o arquivo `config.env` dentro da pasta do executável:
```env
# Configurações do Banco de Dados
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=sua_senha
DB_NAME=sac
DB_CONNECTION_LIMIT=5

# Configurações do Servidor API (Node.js)
API_HOST=localhost
PORT=9000

# Configurações da API DANFE
DANFE_API_KEY=bc045b03-cf17-488c-a03a-e0b716dfe377
DANFE_API_URL=https://api.meudanfe.com.br/v2
```

**IMPORTANTE:** 
- Se o servidor Node.js estiver em outro computador, altere `API_HOST` para o IP desse computador
- A porta deve ser a mesma nos dois arquivos (`.env` do servidor e `config.env` do desktop)

#### 9. Executar o Aplicativo Desktop

Dê duplo clique em:
```
C:\ConsultaNFE\Desktop\SACGerencial.exe
```

## Estrutura Recomendada no Servidor

```
C:\ConsultaNFE\
├── Server\              (Servidor Node.js)
│   ├── server.js
│   ├── package.json
│   ├── .env
│   └── node_modules\
│
└── Desktop\             (Aplicativo Desktop)
    └── net8.0-windows\
        ├── SACGerencial.exe
        ├── config.env
        └── (outros arquivos .dll)
```

## Verificação

### Testar Servidor Node.js
Abra no navegador: `http://localhost:9000`

Se aparecer a página HTML, o servidor está funcionando!

### Testar Desktop
Execute o `SACGerencial.exe` e clique em "Pesquisar".

Se aparecer resultados, tudo está funcionando!

## Solução de Problemas

### Erro: "Servidor não encontrado"
- Verifique se o servidor Node.js está rodando
- Verifique se a porta no `config.env` está correta (9000)
- Verifique se o `API_HOST` está correto

### Erro: "Cannot find module"
- Execute `npm install` na pasta do servidor Node.js
- Verifique se está na pasta correta ao executar `node server.js`

### Erro: "Não foi possível conectar ao banco de dados"
- Verifique se o MySQL está rodando
- Verifique as credenciais no `.env` do servidor
- Verifique se o banco `sac` existe

