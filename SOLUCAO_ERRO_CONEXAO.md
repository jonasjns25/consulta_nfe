# 🔧 Solução para Erro de Conexão com Banco de Dados

## Erro: `ECONNREFUSED`

Este erro indica que a aplicação não consegue se conectar ao banco de dados MySQL/MariaDB.

## ✅ Passos para Resolver

### 1. Verificar se o arquivo `.env` existe

O arquivo `.env` deve estar na raiz do projeto (`C:\consulta_nfe\.env`).

**Se não existir:**
1. Copie o arquivo `env.sample` para `.env`:
   ```cmd
   copy env.sample .env
   ```
2. Edite o arquivo `.env` com as credenciais corretas do seu banco de dados

### 2. Verificar as credenciais no arquivo `.env`

Abra o arquivo `.env` e verifique se as seguintes variáveis estão corretas:

```env
DB_HOST=localhost          # ou o IP do servidor MySQL
DB_USER=root               # usuário do MySQL
DB_PASSWORD=sua_senha      # senha do MySQL
DB_NAME=sac                # nome do banco de dados
DB_PORT=3306               # porta do MySQL (padrão: 3306)
```

**Importante:**
- Se o MySQL está em outro servidor, use o IP ou hostname em `DB_HOST`
- Se a porta não for a padrão (3306), adicione `DB_PORT` no `.env`

### 3. Verificar se o MySQL está rodando

**No Windows:**
1. Abra o **Gerenciador de Serviços** (`services.msc`)
2. Procure por **MySQL** ou **MariaDB**
3. Verifique se o status está como **"Em execução"**
4. Se não estiver, clique com o botão direito e selecione **"Iniciar"**

**Ou via linha de comando:**
```cmd
net start MySQL
```
ou
```cmd
net start MariaDB
```

### 4. Testar a conexão manualmente

Abra o Prompt de Comando e teste a conexão:

```cmd
mysql -h localhost -u root -p
```

- Se conectar, o MySQL está funcionando
- Se não conectar, verifique as credenciais ou se o MySQL está rodando

### 5. Verificar se o banco de dados existe

Conecte ao MySQL e verifique:

```sql
SHOW DATABASES;
```

Se o banco `sac` não existir, crie-o:

```sql
CREATE DATABASE sac;
```

### 6. Executar o script de verificação

Execute o script de diagnóstico que foi criado:

```cmd
node verificar_configuracao.js
```

Este script irá:
- Verificar se o arquivo `.env` existe
- Testar a conexão com o banco
- Verificar se o banco de dados existe
- Verificar se as tabelas necessárias existem

### 7. Verificar firewall

Se o MySQL está em outro servidor, verifique se o firewall permite conexões na porta 3306 (ou a porta configurada).

**No servidor MySQL:**
- Configure o firewall para permitir conexões na porta do MySQL
- Verifique se o MySQL está configurado para aceitar conexões remotas (se necessário)

## 🔍 Diagnóstico Detalhado

### Erro: `ECONNREFUSED`

**Causas comuns:**
1. MySQL não está rodando
2. Host/porta incorretos
3. Firewall bloqueando
4. MySQL não está configurado para aceitar conexões

**Solução:**
- Verifique se o MySQL está rodando
- Verifique o `DB_HOST` e `DB_PORT` no `.env`
- Teste a conexão manualmente com `mysql -h ...`

### Erro: `ER_ACCESS_DENIED_ERROR`

**Causa:** Credenciais incorretas

**Solução:**
- Verifique `DB_USER` e `DB_PASSWORD` no `.env`
- Teste as credenciais manualmente

### Erro: `ENOTFOUND`

**Causa:** Host não encontrado

**Solução:**
- Verifique se o `DB_HOST` está correto
- Se for um hostname, verifique se resolve corretamente
- Tente usar o IP diretamente

## 📋 Checklist Rápido

- [ ] Arquivo `.env` existe na raiz do projeto
- [ ] Variáveis `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` estão configuradas
- [ ] MySQL/MariaDB está rodando
- [ ] Credenciais estão corretas (teste manualmente)
- [ ] Banco de dados existe
- [ ] Firewall não está bloqueando (se MySQL em servidor remoto)
- [ ] Executei `node verificar_configuracao.js` e passou em todos os testes

## 🚀 Após Corrigir

1. Reinicie o servidor:
   ```cmd
   node server.js
   ```

2. O servidor agora deve mostrar:
   ```
   [INFO] Conexão com o banco de dados estabelecida com sucesso!
   [INFO] Servidor rodando em http://localhost:3000
   ```

## 📞 Ainda com Problemas?

Se após seguir todos os passos o problema persistir:

1. Execute o script de verificação e envie a saída completa
2. Verifique os logs do MySQL para mais detalhes
3. Verifique se há outros processos usando a porta do MySQL

