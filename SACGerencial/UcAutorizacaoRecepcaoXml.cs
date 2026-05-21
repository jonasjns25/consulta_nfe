using System;
using System.Data;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace SACGerencial
{
    /// <summary>
    /// Módulo Autorização de Recepção de XML.
    /// Permite selecionar um XML de NF-e, exibir itens (REF/PLU), validar divergências
    /// e autorizar a recepção para facilitar o lançamento das NFs no sistema.
    /// </summary>
    public class UcAutorizacaoRecepcaoXml : UserControl
    {
        private readonly Button btnSelecionarXml;
        private readonly Label lblArquivoSelecionado;
        private readonly DataGridView gridItens;
        private readonly ComboBox cmbNaturezaOperacao;
        private readonly Button btnAnalisar;
        private readonly Button btnSalvar;
        private readonly Label lblResumo;
        private string? _caminhoXmlAtual;

        public UcAutorizacaoRecepcaoXml()
        {
            Dock = DockStyle.Fill;
            BackColor = Color.White;
            Padding = new Padding(10);

            var fontePadrao = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            // Painel superior (título + seleção + legenda)
            var pnlTopo = new Panel
            {
                Dock = DockStyle.Top,
                Height = 140
            };
            Controls.Add(pnlTopo);

            var lblTitulo = new Label
            {
                Text = "Autorização de Recepção de XML",
                Font = new Font("Segoe UI", 14F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(10, 10)
            };
            pnlTopo.Controls.Add(lblTitulo);

            var grpSelecao = new GroupBox
            {
                Text = "Seleção do arquivo XML da nota",
                Font = fontePadrao,
                Location = new Point(10, 45),
                Height = 70
            };
            grpSelecao.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            grpSelecao.Width = Math.Max(400, Width - 40);
            pnlTopo.Controls.Add(grpSelecao);

            btnSelecionarXml = new Button
            {
                Text = "Selecionar arquivo XML...",
                Location = new Point(10, 28),
                Size = new Size(160, 28),
                BackColor = Color.FromArgb(200, 16, 46),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnSelecionarXml.Click += BtnSelecionarXml_Click;
            grpSelecao.Controls.Add(btnSelecionarXml);

            lblArquivoSelecionado = new Label
            {
                Text = "Nenhum arquivo selecionado.",
                Location = new Point(185, 33),
                AutoSize = true,
                ForeColor = Color.Gray
            };
            grpSelecao.Controls.Add(lblArquivoSelecionado);

            var lblLegenda = new Label
            {
                Text = "REF = dados do XML (Danfe)  |  PLU = produto cadastrado no sistema  |  Clique duas vezes na linha para corrigir divergências.",
                Location = new Point(10, 118),
                AutoSize = true,
                Font = new Font("Segoe UI", 8F),
                ForeColor = Color.Gray
            };
            pnlTopo.Controls.Add(lblLegenda);

            // Painel do rodapé (fixo na parte inferior) — adicionado antes do grid para o layout preencher o meio
            var pnlRodape = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 100,
                Padding = new Padding(0)
            };
            Controls.Add(pnlRodape);

            lblResumo = new Label
            {
                Text = "Selecione um arquivo XML para exibir os itens da nota.",
                Location = new Point(10, 8),
                AutoSize = true,
                Font = fontePadrao
            };
            pnlRodape.Controls.Add(lblResumo);

            var grpAcoes = new GroupBox
            {
                Text = "Após validar todos os itens (Situação OK)",
                Font = fontePadrao,
                Location = new Point(10, 32),
                Height = 62,
                Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
            };
            grpAcoes.Width = Math.Max(400, Width - 40);
            pnlRodape.Controls.Add(grpAcoes);

            var lblNatureza = new Label { Text = "Natureza de Operação", Location = new Point(10, 28), AutoSize = true };
            grpAcoes.Controls.Add(lblNatureza);

            cmbNaturezaOperacao = new ComboBox
            {
                Location = new Point(160, 25),
                Size = new Size(320, 23),
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            cmbNaturezaOperacao.Items.Add("(Selecione a natureza de operação)");
            cmbNaturezaOperacao.SelectedIndex = 0;
            grpAcoes.Controls.Add(cmbNaturezaOperacao);

            btnAnalisar = new Button
            {
                Text = "Analisar",
                Location = new Point(500, 23),
                Size = new Size(100, 28),
                BackColor = Color.FromArgb(200, 16, 46),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Enabled = false
            };
            btnAnalisar.Click += BtnAnalisar_Click;
            grpAcoes.Controls.Add(btnAnalisar);

            btnSalvar = new Button
            {
                Text = "Salvar",
                Location = new Point(610, 23),
                Size = new Size(100, 28),
                Enabled = false
            };
            btnSalvar.Click += BtnSalvar_Click;
            grpAcoes.Controls.Add(btnSalvar);

            // Grid de itens (REF / PLU / Situação) — preenche o espaço entre a legenda e o rodapé
            gridItens = new DataGridView
            {
                Dock = DockStyle.Fill,
                ReadOnly = false,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                BackgroundColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = false,
                RowHeadersVisible = true
            };
            gridItens.CellDoubleClick += GridItens_CellDoubleClick;
            Controls.Add(gridItens);

            _caminhoXmlAtual = null;
            ConfigurarColunasGrid();
        }

        private void ConfigurarColunasGrid()
        {
            gridItens.Columns.Clear();
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "NumItem", HeaderText = "#", Width = 40, ReadOnly = true });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "RefDescricao", HeaderText = "REF - Descrição (XML)", ReadOnly = true });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "RefEan", HeaderText = "REF - EAN (XML)", Width = 120, ReadOnly = true });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "RefUnidade", HeaderText = "REF - Unidade", Width = 70, ReadOnly = true });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "PluCodigo", HeaderText = "PLU - Código", Width = 80, ReadOnly = true });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "PluDescricao", HeaderText = "PLU - Descrição (Sistema)", ReadOnly = true });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "PluUnidade", HeaderText = "PLU - Unidade", Width = 70, ReadOnly = true });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "FatorConversao", HeaderText = "Fator Conv.", Width = 80 });
            gridItens.Columns.Add(new DataGridViewTextBoxColumn { Name = "Situacao", HeaderText = "Situação", Width = 180, ReadOnly = true });
        }

        private void BtnSelecionarXml_Click(object? sender, EventArgs e)
        {
            using var ofd = new OpenFileDialog
            {
                Title = "Selecionar XML da NF-e",
                Filter = "Arquivos XML|*.xml|Todos os arquivos|*.*",
                FilterIndex = 1
            };

            if (ofd.ShowDialog() != DialogResult.OK) return;

            _caminhoXmlAtual = ofd.FileName;
            lblArquivoSelecionado.Text = Path.GetFileName(_caminhoXmlAtual);
            lblArquivoSelecionado.ForeColor = Color.Black;

            // Esboço: carregar itens do XML (por enquanto dados de exemplo se o arquivo existir)
            CarregarItensDoXml(_caminhoXmlAtual);
        }

        /// <summary>
        /// Carrega itens no grid a partir do XML (esboço: pode usar dados reais depois).
        /// </summary>
        private void CarregarItensDoXml(string caminho)
        {
            gridItens.Rows.Clear();

            if (!File.Exists(caminho))
            {
                lblResumo.Text = "Arquivo não encontrado.";
                return;
            }

            // TODO: integrar leitura real do XML (NFe/det/prod) e cruzamento com cadastro do sistema
            // Por enquanto: adicionar linhas de exemplo para visualização do layout
            AdicionarLinhasExemplo();

            int total = gridItens.Rows.Count;
            int ok = 0;
            foreach (DataGridViewRow row in gridItens.Rows)
            {
                var sit = row.Cells["Situacao"]?.Value?.ToString() ?? "";
                if (sit.StartsWith("OK", StringComparison.OrdinalIgnoreCase)) ok++;
            }
            lblResumo.Text = $"{total} item(ns) | {ok} validado(s) | {total - ok} pendente(s) de análise.";
            btnAnalisar.Enabled = total > 0;
        }

        private void AdicionarLinhasExemplo()
        {
            // Dados de exemplo para visualizar a estrutura REF / PLU / Situação
            gridItens.Rows.Add("1", "Produto Exemplo A (XML)", "7891234567890", "UN", "1001", "Produto A - Cadastro Sistema", "UN", "1", "OK - Pendente de Análise");
            gridItens.Rows.Add("2", "Produto Exemplo B (XML)", "7891234567891", "CX", "", "", "", "", "Produto Não Cadastrado");
            gridItens.Rows.Add("3", "Produto Exemplo C (XML)", "7891234567892", "PAR", "1003", "Produto C - Cadastro", "UN", "2", "Divergência entre Embalagem e Unidade");
        }

        private void GridItens_CellDoubleClick(object? sender, DataGridViewCellEventArgs e)
        {
            if (e.RowIndex < 0) return;

            var situacao = gridItens.Rows[e.RowIndex].Cells["Situacao"]?.Value?.ToString() ?? string.Empty;
            // Abrir tela para associar produto manualmente (PLU), ajustar unidade ou fator de conversão
            MessageBox.Show(
                "Tela de correção de divergência (em desenvolvimento).\n\n" +
                "Aqui você poderá:\n" +
                "• Associar o produto do XML a um PLU (digitar código ou pesquisar na lupa)\n" +
                "• Preencher o Fator de Conversão por Embalagem de Compra\n" +
                "• Ajustar unidade (XML x Sistema)\n\n" +
                "Situação da linha: " + situacao,
                "Corrigir divergência",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void BtnAnalisar_Click(object? sender, EventArgs e)
        {
            // TODO: verificar pedido de compra, conformidade valor/quantidade, bloqueios
            bool todosOk = true;
            foreach (DataGridViewRow row in gridItens.Rows)
            {
                var sit = row.Cells["Situacao"]?.Value?.ToString() ?? "";
                if (!sit.StartsWith("OK", StringComparison.OrdinalIgnoreCase))
                {
                    todosOk = false;
                    break;
                }
            }

            if (!todosOk)
            {
                MessageBox.Show(
                    "Existem itens com divergência. Corrija todas as situações (duplo clique na linha) até que fiquem \"OK - Pendente de Análise\" antes de analisar.",
                    "Atenção",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            if (cmbNaturezaOperacao.SelectedIndex <= 0)
            {
                MessageBox.Show("Selecione a Natureza de Operação.", "Atenção", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            MessageBox.Show(
                "Análise (em desenvolvimento).\n\nSerá verificado: Pedido de Compra, conformidade de valores e quantidades, bloqueios configurados.",
                "Analisar",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            btnSalvar.Enabled = true;
        }

        private void BtnSalvar_Click(object? sender, EventArgs e)
        {
            MessageBox.Show(
                "Salvar (em desenvolvimento).\n\nO XML será autorizado e ficará pronto para a próxima etapa no processo de entrada de nota fiscal.",
                "Salvar",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
    }
}
