# Como Rodar o Servidor Node.js

## ⚠️ IMPORTANTE: Onde está o server.js?

O arquivo `server.js` **NÃO está** na pasta `net8.0-windows`!

Ele está na **raiz do projeto**, junto com:
- `server.js`
- `package.json`
- `index.html`
- `detalhes.html`
- `.env` ou `config.env`

## ✅ Solução Rápida

### Opção 1: Navegar para a pasta correta

```powershell
# Volte para a raiz do projeto
cd C:\consulta_nfe - Desktop

# Agora execute o servidor
node server.js
```

### Opção 2: Usar o script (mais fácil)

Na raiz do projeto, execute:
```powershell
.\iniciar_servidor.bat
```

## 📁 Estrutura Correta

```
C:\consulta_nfe - Desktop\          ← AQUI está o server.js
├── server.js                        ← Execute node server.js AQUI
├── package.json
├── .env ou config.env
├── index.html
├── detalhes.html
│
└── SACGerencial\
    └── bin\
        └── Debug\
            └── net8.0-windows\      ← AQUI está o SACGerencial.exe
                ├── SACGerencial.exe
                └── config.env
```

## 🔧 Passos para Rodar no Outro Servidor

### 1. Copiar arquivos do servidor Node.js

Copie da raiz do projeto para o servidor:
- `server.js`
- `package.json`
- `package-lock.json` (se existir)
- `.env` ou `config.env`

### 2. Criar pasta no servidor

Exemplo:
```
C:\ConsultaNFE\Server\
```

### 3. Colocar os arquivos lá

```
C:\ConsultaNFE\Server\
├── server.js
├── package.json
└── .env
```

### 4. Instalar dependências

```powershell
cd C:\ConsultaNFE\Server
npm install
```

### 5. Configurar o .env

Edite o `.env`:
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

### 6. Rodar o servidor

```powershell
cd C:\ConsultaNFE\Server
node server.js
```

Você deve ver:
```
[INFO] Servidor rodando em http://localhost:9000
```

## ✅ Verificação

Teste no navegador: `http://localhost:9000`

Se aparecer a página HTML, está funcionando!

