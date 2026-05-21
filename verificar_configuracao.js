// Script para verificar configuração do banco de dados
require('dotenv').config();
const mysql = require('mysql2/promise');

async function verificarConfiguracao() {
    console.log('\n==================================================');
    console.log('  Verificação de Configuração - Consulta NF-e');
    console.log('==================================================\n');
    
    // Verificar variáveis de ambiente
    console.log('[1] Verificando variáveis de ambiente...');
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'sac',
        port: process.env.DB_PORT || 3306
    };
    
    console.log(`   DB_HOST: ${config.host}`);
    console.log(`   DB_USER: ${config.user}`);
    console.log(`   DB_PASSWORD: ${config.password ? '*** (configurado)' : 'NÃO CONFIGURADO'}`);
    console.log(`   DB_NAME: ${config.database}`);
    console.log(`   DB_PORT: ${config.port}`);
    console.log(`   PORT: ${process.env.PORT || 3000}`);
    
    // Verificar se arquivo .env existe
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        console.log('   ✓ Arquivo .env encontrado');
    } else {
        console.log('   ✗ Arquivo .env NÃO encontrado');
        console.log('   → Crie um arquivo .env baseado no env.sample');
    }
    
    // Tentar conectar ao banco
    console.log('\n[2] Testando conexão com o banco de dados...');
    let connection;
    try {
        connection = await mysql.createConnection({
            host: config.host,
            user: config.user,
            password: config.password,
            port: config.port
        });
        
        await connection.ping();
        console.log('   ✓ Conexão com MySQL estabelecida');
        
        // Verificar se o banco existe
        console.log('\n[3] Verificando banco de dados...');
        const [databases] = await connection.query('SHOW DATABASES LIKE ?', [config.database]);
        
        if (databases.length > 0) {
            console.log(`   ✓ Banco de dados '${config.database}' existe`);
            
            // Conectar ao banco específico
            await connection.query(`USE ${config.database}`);
            
            // Verificar tabelas
            console.log('\n[4] Verificando tabelas necessárias...');
            const [tables] = await connection.query('SHOW TABLES');
            const tableNames = tables.map(row => Object.values(row)[0]);
            
            const tabelasNecessarias = ['nfe_xml', 'compra', 'funciona', 'itemcomp'];
            tabelasNecessarias.forEach(tabela => {
                if (tableNames.includes(tabela)) {
                    console.log(`   ✓ Tabela '${tabela}' existe`);
                } else {
                    console.log(`   ✗ Tabela '${tabela}' NÃO encontrada`);
                }
            });
            
            // Verificar função calculo_digito
            console.log('\n[5] Verificando função calculo_digito...');
            try {
                const [functions] = await connection.query(
                    `SELECT ROUTINE_NAME FROM information_schema.ROUTINES 
                     WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = 'calculo_digito'`,
                    [config.database]
                );
                if (functions.length > 0) {
                    console.log('   ✓ Função calculo_digito existe');
                } else {
                    console.log('   ⚠ Função calculo_digito não encontrada (pode causar erros)');
                }
            } catch (err) {
                console.log('   ⚠ Não foi possível verificar função calculo_digito');
            }
            
        } else {
            console.log(`   ✗ Banco de dados '${config.database}' NÃO existe`);
            console.log(`   → Execute: CREATE DATABASE ${config.database};`);
        }
        
        await connection.end();
        console.log('\n==================================================');
        console.log('  Verificação concluída!');
        console.log('==================================================\n');
        
    } catch (error) {
        console.log('   ✗ ERRO ao conectar ao banco de dados');
        console.log(`\n   Detalhes do erro:`);
        console.log(`   Código: ${error.code || 'DESCONHECIDO'}`);
        console.log(`   Mensagem: ${error.message || 'Sem mensagem'}`);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('\n   Possíveis soluções:');
            console.log('   1. Verifique se o MySQL/MariaDB está rodando');
            console.log('   2. Verifique se o host/porta estão corretos');
            console.log('   3. Verifique se o firewall não está bloqueando');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.log('\n   Possíveis soluções:');
            console.log('   1. Verifique se o usuário e senha estão corretos');
            console.log('   2. Verifique se o usuário tem permissão de acesso');
        } else if (error.code === 'ENOTFOUND') {
            console.log('\n   Possíveis soluções:');
            console.log('   1. Verifique se o host está correto');
            console.log('   2. Verifique a conectividade de rede');
        }
        
        console.log('\n==================================================\n');
        process.exit(1);
    }
}

verificarConfiguracao().catch(error => {
    console.error('Erro inesperado:', error);
    process.exit(1);
});

