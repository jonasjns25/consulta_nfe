# 🌐 Como Testar a Versão Web

## 📋 Pré-requisitos

1. **Node.js instalado** (versão 14 ou superior)
   - Verificar: `node --version`
   - Download: https://nodejs.org/

2. **MySQL/MariaDB rodando** com o banco de dados configurado

3. **Arquivo de configuração** (`.env` ou `config.env`) na raiz do projeto

## 🚀 Passos para Testar

### Opção 1: Usar o Script Automático (Recomendado)

1. **Abra o PowerShell ou Prompt de Comando** na raiz do projeto:
   ```
   C:\consulta_nfe - Desktop
   ```

2. **Execute o script:**
   ```batch
   .\iniciar_servidor.bat
   ```

   O script irá:
   - Verificar se Node.js está instalado
   - Instalar dependências automaticamente (se necessário)
   - Iniciar o servidor na porta 9000

### Opção 2: Manual

1. **Navegue para a raiz do projeto:**
   ```powershell
   cd C:\consulta_nfe - Desktop
   ```

2. **Instale as dependências** (se ainda não instalou):
   ```powershell
   npm install
   ```

3. **Verifique o arquivo de configuração:**
   
   Crie ou edite o arquivo `.env` na raiz do projeto:
   ```env
   PORT=9000
   DB_HOST=localhost
   DB_USER=seu_usuario
   DB_PASSWORD=sua_senha
   DB_NAME=sac
   DB_CONNECTION_LIMIT=5
   DANFE_API_KEY=bc045b03-cf17-488c-a03a-e0b716dfe377
   DANFE_API_URL=https://api.meudanfe.com.br/v2
   ```

4. **Inicie o servidor:**
   ```powershell
   node server.js
   ```

## ✅ Verificar se Está Funcionando

Quando o servidor iniciar, você verá mensagens como:
```
[INFO] Servidor rodando em http://localhost:9000
[INFO] Conexão com o banco de dados estabelecida com sucesso!
```

## 🌐 Acessar no Navegador

Abra seu navegador e acesse:

- **Página principal:** http://localhost:9000
- **Página de detalhes:** http://localhost:9000/detalhes.html?chave=CHAVE_DA_NFE

## 🔍 Funcionalidades para Testar

### 1. Página de Consulta (`index.html`)
- ✅ Filtros por data, fornecedor, chave
- ✅ Grid com resultados
- ✅ Botões de ação (ícones): Detalhes, DANFE, XML, Copiar
- ✅ Exportação para CSV
- ✅ Tooltips nos botões

### 2. Página de Detalhes (`detalhes.html`)
- ✅ Informações gerais da NF-e
- ✅ Totais da NF-e
- ✅ Lista de produtos
- ✅ Botões no cabeçalho: DANFE, XML, Copiar
- ✅ Detalhes expandidos por produto
- ✅ Comparação XML vs ERP
- ✅ Campos completos de ICMS com nomes técnicos
- ✅ Percentual de redução com conversão e nota explicativa
- ✅ Alinhamento visual melhorado

## 🐛 Solução de Problemas

### Erro: "Cannot find module"
```powershell
npm install
```

### Erro: "Port 9000 is already in use"
- Feche outros programas usando a porta 9000
- Ou altere a porta no arquivo `.env`: `PORT=9001`

### Erro de conexão com banco de dados
- Verifique se o MySQL está rodando
- Confirme as credenciais no arquivo `.env`
- Teste a conexão manualmente

### Página não carrega
- Verifique se o servidor está rodando (veja a mensagem no terminal)
- Confirme que está acessando `http://localhost:9000` (não `file://`)
- Verifique o console do navegador (F12) para erros

## 📝 Notas Importantes

- O servidor deve estar rodando para acessar a versão web
- Os arquivos HTML não funcionam abrindo diretamente (file://) - precisam do servidor
- A porta padrão é **9000** (conforme configurado)
- O servidor serve os arquivos estáticos (HTML, CSS, JS) automaticamente

## 🛑 Parar o Servidor

No terminal onde o servidor está rodando, pressione:
```
Ctrl + C
```

