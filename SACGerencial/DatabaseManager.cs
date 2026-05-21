using System;
using System.Data;
using MySql.Data.MySqlClient;

namespace SACGerencial
{
    public static class DatabaseManager
    {
        private static string GetConnectionString()
        {
            return $"Server={ConfigManager.DbHost};" +
                   $"Database={ConfigManager.DbName};" +
                   $"User ID={ConfigManager.DbUser};" +
                   $"Password={ConfigManager.DbPassword};" +
                   $"Connection Timeout=30;";
        }

        public static bool TestConnection()
        {
            try
            {
                using var connection = new MySqlConnection(GetConnectionString());
                connection.Open();
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static MySqlConnection GetConnection()
        {
            return new MySqlConnection(GetConnectionString());
        }

        public static DataTable ExecuteQuery(string query, params MySqlParameter[] parameters)
        {
            var dataTable = new DataTable();
            
            try
            {
                using var connection = GetConnection();
                connection.Open();
                
                using var command = new MySqlCommand(query, connection);
                if (parameters != null && parameters.Length > 0)
                {
                    command.Parameters.AddRange(parameters);
                }
                
                using var adapter = new MySqlDataAdapter(command);
                adapter.Fill(dataTable);
            }
            catch (Exception ex)
            {
                throw new Exception($"Erro ao executar consulta: {ex.Message}", ex);
            }
            
            return dataTable;
        }

        public static object ExecuteScalar(string query, params MySqlParameter[] parameters)
        {
            try
            {
                using var connection = GetConnection();
                connection.Open();
                
                using var command = new MySqlCommand(query, connection);
                if (parameters != null && parameters.Length > 0)
                {
                    command.Parameters.AddRange(parameters);
                }
                
                return command.ExecuteScalar();
            }
            catch (Exception ex)
            {
                throw new Exception($"Erro ao executar comando: {ex.Message}", ex);
            }
        }
    }
}

