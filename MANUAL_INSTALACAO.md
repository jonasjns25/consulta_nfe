# Manual de Instalação - Consulta NF-e

## 📋 Índice

1. [Requisitos do Sistema](#requisitos-do-sistema)
2. [Instalação Manual Passo a Passo](#instalação-manual-passo-a-passo)
3. [Configuração do Banco de Dados](#configuração-do-banco-de-dados)
4. [Iniciar o Servidor](#iniciar-o-servidor)
5. [Verificação da Instalação](#verificação-da-instalação)
6. [Solução de Problemas](#solução-de-problemas)
7. [Estrutura de Arquivos](#estrutura-de-arquivos)

---

## 🖥️ Requisitos do Sistema

- **Sistema Operacional**: Windows 10 ou superior
- **Node.js**: Versão 20.10.0 ou superior
- **npm**: Incluído com o Node.js
- **Acesso à Internet**: Necessário para instalar dependências
- **Banco de Dados**: MySQL/MariaDB com as tabelas `nfe_xml` e `compra` configuradas
- **Porta**: Porta 3000 disponível (ou configure outra porta no arquivo `.env`)

---

## 🚀 Instalação Manual Passo a Passo

### Passo 1: Instalar Node.js

1. **Baixe o Node.js**:
   - Acesse: https://nodejs.org/
   - Baixe a versão **LTS (Long Term Support)** - recomendado: **20.10.0 ou superior**
   - Escolha o instalador Windows (`.msi`)

2. **Execute o instalador**:
   - Clique duas vezes no arquivo baixado
   - Siga o assistente de instalação
   - **Importante**: Marque a opção "Add to PATH" durante a instalação
   - Conclua a instalação

3. **Verifique a instalação**:
   - Abra o **Prompt de Comando (CMD)** ou **PowerShell**
   - Execute os comandos:
     ```cmd
     node -v
     npm -v
     ```
   - Deve retornar as versões instaladas (ex: `v20.10.0` e `10.x.x`)

### Passo 2: Preparar os Arquivos do Projeto

1. **Copie os arquivos do projeto** para um diretório no servidor:
   - Exemplo: `C:\consulta_nfe`
   - Certifique-se de que todos os arquivos estão presentes:
     - `index.html`
     - `server.js`
     - `package.json`
     - `package-lock.json` (se existir)
     - `env.sample`

2. **Abra o Prompt de Comando** e navegue até o diretório:
   ```cmd
   cd C:\consulta_nfe
   ```

### Passo 3: Instalar Dependências do Projeto

1. **No Prompt de Comando**, execute:
   ```cmd
   npm install
   ```
   
   Ou, se preferir instalar apenas dependências de produção:
   ```cmd
   npm install --production
   ```

2. **Aguarde a instalação**:
   - O npm irá baixar e instalar todas as dependências listadas no `package.json`
   - Isso pode levar alguns minutos dependendo da conexão
   - Você verá mensagens de progresso no console

3. **Verifique se a instalação foi bem-sucedida**:
   - Deve aparecer a mensagem: `added X packages`
   - Uma pasta `node_modules` deve ser criada no diretório do projeto

### Passo 4: Configurar o Arquivo .env

1. **Crie o arquivo `.env`** na raiz do projeto:
   - Copie o arquivo `env.sample` para `.env`:
     ```cmd
     copy env.sample .env
     ```
   - Ou crie manualmente um arquivo chamado `.env` (sem extensão)

2. **Edite o arquivo `.env`** com um editor de texto (Bloco de Notas, Notepad++, etc.):
   ```env
   PORT=3000
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=sua_senha_aqui
   DB_NAME=sac
   DB_CONNECTION_LIMIT=5
   DANFE_API_KEY=bc045b03-cf17-488c-a03a-e0b716dfe377
   DANFE_API_URL=https://api.meudanfe.com.br/v2
   ```

3. **Ajuste as variáveis conforme seu ambiente**:
   - `DB_HOST`: Endereço do servidor MySQL (use `localhost` se estiver na mesma máquina)
   - `DB_USER`: Usuário do banco de dados
   - `DB_PASSWORD`: Senha do banco de dados
   - `DB_NAME`: Nome do banco de dados (padrão: `sac`)
   - `PORT`: Porta onde o servidor irá rodar (padrão: `3000`)

### Passo 5: Verificar Estrutura do Banco de Dados

Certifique-se de que o banco de dados MySQL possui:

1. **Banco de dados criado**:
   - Nome do banco: `sac` (ou o nome configurado no `.env`)

2. **Tabelas necessárias**:
   - **`nfe_xml`**: Tabela com os dados das NF-e
   - **`compra`**: Tabela com as compras lançadas

3. **Relacionamento entre tabelas**:
   - A relação é feita através de:
     - `nfe_xml.CHAVE` = `compra.CHAVE_NFE`

4. **Teste a conexão**:
   ```cmd
   mysql -h localhost -u root -p
   ```
   - Digite a senha quando solicitado
   - Execute: `USE sac;`
   - Execute: `SHOW TABLES;`
   - Deve listar as tabelas `nfe_xml` e `compra`

---

## ▶️ Iniciar o Servidor

### Método 1: Execução Direta (Recomendado para Testes)

1. **Abra o Prompt de Comando** e navegue até o diretório do projeto:
   ```cmd
   cd C:\consulta_nfe
   ```

2. **Inicie o servidor**:
   ```cmd
   node server.js
   ```

3. **Você verá mensagens no console**:
   ```
   Servidor rodando em http://localhost:3000
   ```

4. **Mantenha a janela aberta** enquanto o servidor estiver rodando
   - Para parar o servidor, pressione `Ctrl + C`

### Método 2: Execução em Segundo Plano

1. **No Prompt de Comando**, execute:
   ```cmd
   start /B node server.js
   ```

2. **O servidor rodará em segundo plano**
   - A janela do CMD pode ser fechada
   - Para parar, use o Gerenciador de Tarefas

### Método 3: Usando npm start

1. **No Prompt de Comando**, execute:
   ```cmd
   npm start
   ```

2. **Funciona da mesma forma que `node server.js`**

### Método 4: Criar um Atalho para Iniciar

1. **Crie um arquivo `.bat`** chamado `iniciar_servidor.bat`:
   ```bat
   @echo off
   cd /d "%~dp0"
   node server.js
   pause
   ```

2. **Execute o arquivo** clicando duas vezes nele
   - O servidor iniciará e a janela permanecerá aberta

---

## ✅ Verificação da Instalação

### 1. Verificar se o Servidor Está Rodando

1. **Verifique o console**:
   - Deve mostrar: `Servidor rodando em http://localhost:3000`
   - Não deve apresentar erros de conexão com o banco

2. **Acesse no navegador**:
   - Abra: `http://localhost:3000`
   - A página deve carregar normalmente
   - Os filtros de consulta devem estar visíveis

3. **Teste uma consulta**:
   - Preencha as datas (ex: últimos 7 dias)
   - Clique em "Consultar"
   - Deve retornar resultados ou uma mensagem informativa

### 2. Verificar Dependências Instaladas

No Prompt de Comando, execute:
```cmd
npm list --depth=0
```

Deve listar as dependências:
- `express`
- `mysql2`
- `axios`
- `dotenv`

### 3. Verificar Conexão com Banco de Dados

Se o servidor iniciar sem erros relacionados ao banco, a conexão está funcionando.

Se houver erro de conexão, verifique:
- Credenciais no arquivo `.env`
- MySQL está rodando
- Firewall não está bloqueando a conexão

---

## 🔧 Solução de Problemas

### Erro: "node não é reconhecido como comando"

**Causa**: Node.js não está no PATH do sistema.

**Solução**:
1. Reinstale o Node.js marcando a opção "Add to PATH"
2. Ou adicione manualmente ao PATH:
   - Vá em: Painel de Controle → Sistema → Configurações Avançadas → Variáveis de Ambiente
   - Adicione `C:\Program Files\nodejs\` ao PATH
   - Reinicie o computador

### Erro: "Cannot find module 'express'"

**Causa**: Dependências não foram instaladas.

**Solução**:
```cmd
cd C:\consulta_nfe
npm install
```

### Erro: "Cannot connect to database"

**Possíveis causas e soluções**:

1. **MySQL não está rodando**:
   - Inicie o serviço MySQL
   - Verifique no Gerenciador de Serviços do Windows

2. **Credenciais incorretas**:
   - Verifique o arquivo `.env`
   - Teste a conexão manualmente:
     ```cmd
     mysql -h localhost -u root -p
     ```

3. **Banco de dados não existe**:
   - Crie o banco: `CREATE DATABASE sac;`
   - Ou altere `DB_NAME` no `.env`

4. **Firewall bloqueando**:
   - Configure o firewall para permitir conexões MySQL

### Erro: "Port 3000 already in use"

**Causa**: Outro processo está usando a porta 3000.

**Solução 1 - Alterar a porta**:
1. Edite o arquivo `.env`:
   ```env
   PORT=3001
   ```
2. Reinicie o servidor
3. Acesse: `http://localhost:3001`

**Solução 2 - Encontrar e finalizar o processo**:
1. Abra o Gerenciador de Tarefas (`Ctrl + Shift + Esc`)
2. Procure por `node.exe`
3. Finalize o processo
4. Reinicie o servidor

### Erro: "npm install falha"

**Possíveis causas**:

1. **Sem conexão com internet**:
   - Verifique sua conexão
   - Se estiver em rede corporativa, configure proxy:
     ```cmd
     npm config set proxy http://proxy:porta
     npm config set https-proxy http://proxy:porta
     ```

2. **Cache corrompido**:
   ```cmd
   npm cache clean --force
   npm install
   ```

3. **Permissões insuficientes**:
   - Execute o CMD como administrador
   - Verifique permissões de escrita na pasta do projeto

### Página em branco ou erro 404

**Solução**:
1. Verifique se o arquivo `index.html` está na raiz do projeto
2. Verifique se o servidor está rodando (console sem erros)
3. Verifique a porta no navegador: `http://localhost:3000`
4. Limpe o cache do navegador (`Ctrl + F5`)

### Erro ao gerar DANFE

**Solução**:
1. Verifique se a chave da API está correta no `.env`:
   ```env
   DANFE_API_KEY=bc045b03-cf17-488c-a03a-e0b716dfe377
   ```
2. Verifique conexão com a internet
3. Verifique se a chave da NF-e está correta

---

## 📁 Estrutura de Arquivos

```
consulta_nfe/
│
├── index.html              # Interface do usuário (frontend)
├── server.js               # Servidor Node.js/Express (backend)
├── package.json            # Dependências e configurações do projeto
├── package-lock.json       # Versões fixas das dependências
├── env.sample              # Template de configuração
├── .env                    # Configurações (criar manualmente)
├── MANUAL_INSTALACAO.md   # Este manual
│
├── node_modules/           # Dependências instaladas (criado pelo npm)
│   ├── express/
│   ├── mysql2/
│   ├── axios/
│   └── dotenv/
│
└── logs/                   # Diretório de logs (criado automaticamente)
    └── server.log          # Logs do servidor (se configurado)
```

---

## 📞 Comandos Úteis

### Verificar Versões
```cmd
node -v          # Versão do Node.js
npm -v           # Versão do npm
```

### Gerenciar o Servidor
```cmd
node server.js                    # Iniciar servidor
npm start                         # Iniciar servidor (alternativa)
Ctrl + C                          # Parar servidor
```

### Verificar Porta em Uso
```cmd
netstat -ano | findstr :3000
```

### Listar Dependências
```cmd
npm list --depth=0
```

### Reinstalar Dependências
```cmd
rmdir /s /q node_modules
del package-lock.json
npm install
```

---

## ✅ Checklist de Instalação

Use este checklist para garantir que tudo está configurado:

- [ ] Node.js instalado (versão 20.10.0 ou superior)
- [ ] npm funcionando (`npm -v` retorna versão)
- [ ] Arquivos do projeto copiados para o servidor
- [ ] Dependências instaladas (`npm install` executado com sucesso)
- [ ] Pasta `node_modules` criada
- [ ] Arquivo `.env` criado e configurado
- [ ] Credenciais do banco de dados corretas no `.env`
- [ ] MySQL/MariaDB rodando e acessível
- [ ] Banco de dados `sac` existe
- [ ] Tabelas `nfe_xml` e `compra` existem no banco
- [ ] Servidor inicia sem erros (`node server.js`)
- [ ] Página carrega em `http://localhost:3000`
- [ ] Consulta retorna resultados ou mensagem apropriada

---

## 🔄 Atualização do Sistema

### Atualizar Dependências

```cmd
cd C:\consulta_nfe
npm update
```

### Reinstalar Tudo do Zero

1. Pare o servidor (`Ctrl + C`)
2. Delete a pasta `node_modules`:
   ```cmd
   rmdir /s /q node_modules
   ```
3. Delete `package-lock.json` (opcional)
4. Reinstale:
   ```cmd
   npm install
   ```
5. Reinicie o servidor

---

## 📝 Notas Importantes

- **Porta padrão**: 3000 (pode ser alterada no `.env`)
- **Banco de dados padrão**: `sac` (pode ser alterado no `.env`)
- **Logs**: Se configurado, os logs serão salvos em `logs\server.log`
- **Reinicialização**: Após alterar o `.env`, reinicie o servidor
- **Segurança**: Nunca compartilhe o arquivo `.env` com credenciais

---

**Última atualização**: Janeiro 2025
