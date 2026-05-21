using System;
using System.Windows.Forms;

namespace SACGerencial
{
    internal static class Program
    {
        /// <summary>
        /// Ponto de entrada principal para o aplicativo.
        /// </summary>
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            
            // Carregar configurações
            ConfigManager.Load();
            
            // Verificar conexão com banco
            if (!DatabaseManager.TestConnection())
            {
                var result = MessageBox.Show(
                    "Não foi possível conectar ao banco de dados.\n\n" +
                    "Verifique as configurações em config.env\n\n" +
                    "Deseja continuar mesmo assim?",
                    "Aviso de Conexão",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                
                if (result == DialogResult.No)
                {
                    return;
                }
            }
            
            Application.Run(new FrmPrincipal());
        }
    }
}

