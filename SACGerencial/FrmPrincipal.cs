using System;
using System.Drawing;
using System.Windows.Forms;

namespace SACGerencial
{
    public partial class FrmPrincipal : Form
    {
        public FrmPrincipal()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();

            // Configurações do formulário principal
            this.Text = "SAC Gerencial - Consulta NF-e";
            this.WindowState = FormWindowState.Maximized;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.White;
            this.MinimumSize = new Size(1200, 700);

            var tabControl = new TabControl
            {
                Dock = DockStyle.Fill,
                Font = new Font("Segoe UI", 9F)
            };

            var tabConsulta = new TabPage("Consulta NF-e");
            var consultaNFe = new UcConsultaNFe { Dock = DockStyle.Fill };
            tabConsulta.Controls.Add(consultaNFe);
            tabControl.TabPages.Add(tabConsulta);

            var tabAutorizacao = new TabPage("Autorização de Recepção de XML");
            var autorizacaoXml = new UcAutorizacaoRecepcaoXml { Dock = DockStyle.Fill };
            tabAutorizacao.Controls.Add(autorizacaoXml);
            tabControl.TabPages.Add(tabAutorizacao);

            this.Controls.Add(tabControl);

            this.ResumeLayout(false);
        }
    }
}
