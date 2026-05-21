using System;
using System.IO;

namespace SACGerencial
{
    public static class ConfigManager
    {
        public static string DbHost { get; private set; } = "localhost";
        public static string DbUser { get; private set; } = "root";
        public static string DbPassword { get; private set; } = "root";
        public static string DbName { get; private set; } = "sac";
        public static int DbConnectionLimit { get; private set; } = 5;
        public static string ApiHost { get; private set; } = "localhost";
        public static int Port { get; private set; } = 9000;
        public static string DanfeApiKey { get; private set; } = "bc045b03-cf17-488c-a03a-e0b716dfe377";
        public static string DanfeApiUrl { get; private set; } = "https://api.meudanfe.com.br/v2";

        public static void Load()
        {
            var configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "config.env");
            
            if (!File.Exists(configPath))
            {
                // Tentar carregar do diretório pai (onde está o projeto Node.js)
                var parentConfigPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "config.env");
                if (File.Exists(parentConfigPath))
                {
                    configPath = parentConfigPath;
                }
                else
                {
                    // Criar arquivo de exemplo
                    CreateSampleConfig(configPath);
                    return;
                }
            }

            LoadFromFile(configPath);
        }

        private static void LoadFromFile(string filePath)
        {
            try
            {
                var lines = File.ReadAllLines(filePath);
                
                foreach (var line in lines)
                {
                    var trimmed = line.Trim();
                    if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith("#"))
                        continue;

                    var parts = trimmed.Split('=', 2);
                    if (parts.Length != 2)
                        continue;

                    var key = parts[0].Trim();
                    var value = parts[1].Trim();

                    switch (key.ToUpper())
                    {
                        case "DB_HOST":
                            DbHost = value;
                            break;
                        case "DB_USER":
                            DbUser = value;
                            break;
                        case "DB_PASSWORD":
                            DbPassword = value;
                            break;
                        case "DB_NAME":
                            DbName = value;
                            break;
                        case "DB_CONNECTION_LIMIT":
                            if (int.TryParse(value, out var limit))
                                DbConnectionLimit = limit;
                            break;
                        case "API_HOST":
                        case "SERVER_HOST":
                            ApiHost = value;
                            break;
                        case "PORT":
                        case "API_PORT":
                        case "SERVER_PORT":
                            if (int.TryParse(value, out var port))
                                Port = port;
                            break;
                        case "DANFE_API_KEY":
                            DanfeApiKey = value;
                            break;
                        case "DANFE_API_URL":
                            DanfeApiUrl = value;
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Erro ao carregar config.env: {ex.Message}");
            }
        }

        private static void CreateSampleConfig(string filePath)
        {
            try
            {
                var sampleContent = @"# Configurações do Banco de Dados
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=sac
DB_CONNECTION_LIMIT=5

# Configurações do Servidor API (Node.js)
API_HOST=localhost
PORT=9000

# Configurações da API DANFE
DANFE_API_KEY=bc045b03-cf17-488c-a03a-e0b716dfe377
DANFE_API_URL=https://api.meudanfe.com.br/v2
";
                File.WriteAllText(filePath, sampleContent);
            }
            catch
            {
                // Ignorar erro ao criar arquivo de exemplo
            }
        }
    }
}

