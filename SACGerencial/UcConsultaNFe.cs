using System;
using System.Collections.Generic;
using System.Data;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SACGerencial
{
    /// <summary>
    /// Tela principal de Consulta de NF-e.
    /// Consome o servidor Node (server.js) exposto em http://localhost:PORT.
    /// </summary>
    public class UcConsultaNFe : UserControl
    {
        private readonly TextBox txtDataInicial;
        private readonly TextBox txtDataFinal;
        private readonly TextBox txtCnpj;
        private readonly TextBox txtRazao;
        private readonly TextBox txtNumero;
        private readonly TextBox txtChave;
        private readonly ComboBox cmbStatus;
        private readonly TextBox txtUsuario;
        private readonly DataGridView gridResultados;
        private readonly Button btnPesquisar;
        private readonly Button btnExportarCsv;
        private readonly Label lblEstatisticas;
        
        private readonly HttpClient httpClient = new HttpClient();
        private List<JsonElement> dadosAtuais = new List<JsonElement>();

        public UcConsultaNFe()
        {
            Dock = DockStyle.Fill;
            BackColor = Color.White;
            Padding = new Padding(10);

            var fontePadrao = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            // Título
            var lblTitulo = new Label
            {
                Text = "Consulta NF-e",
                Font = new Font("Segoe UI", 14F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(10, 10)
            };
            Controls.Add(lblTitulo);

            // Painel de filtros
            var grpFiltros = new GroupBox
            {
                Text = "Filtros de Pesquisa",
                Font = fontePadrao,
                Location = new Point(10, 45),
                Height = 130
            };
            grpFiltros.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            grpFiltros.Width = Width - 40;
            Controls.Add(grpFiltros);

            int linha1Y = 25;
            int linha2Y = 60;

            // Datas
            grpFiltros.Controls.Add(new Label { Text = "Data Inicial", Location = new Point(10, linha1Y), AutoSize = true });
            txtDataInicial = new TextBox 
            { 
                Location = new Point(90, linha1Y - 3), 
                Size = new Size(100, 23), 
                Text = DateTime.Today.AddDays(-7).ToString("dd/MM/yyyy") 
            };
            grpFiltros.Controls.Add(txtDataInicial);

            grpFiltros.Controls.Add(new Label { Text = "Data Final", Location = new Point(200, linha1Y), AutoSize = true });
            txtDataFinal = new TextBox 
            { 
                Location = new Point(275, linha1Y - 3), 
                Size = new Size(100, 23), 
                Text = DateTime.Today.ToString("dd/MM/yyyy") 
            };
            grpFiltros.Controls.Add(txtDataFinal);

            // CNPJ e Razão
            grpFiltros.Controls.Add(new Label { Text = "CNPJ/CPF", Location = new Point(390, linha1Y), AutoSize = true });
            txtCnpj = new TextBox { Location = new Point(460, linha1Y - 3), Size = new Size(140, 23) };
            grpFiltros.Controls.Add(txtCnpj);

            grpFiltros.Controls.Add(new Label { Text = "Razão Social", Location = new Point(610, linha1Y), AutoSize = true });
            txtRazao = new TextBox { Location = new Point(690, linha1Y - 3), Size = new Size(200, 23) };
            grpFiltros.Controls.Add(txtRazao);

            // Número e Chave
            grpFiltros.Controls.Add(new Label { Text = "Número NF", Location = new Point(10, linha2Y), AutoSize = true });
            txtNumero = new TextBox { Location = new Point(90, linha2Y - 3), Size = new Size(100, 23) };
            grpFiltros.Controls.Add(txtNumero);

            grpFiltros.Controls.Add(new Label { Text = "Chave", Location = new Point(200, linha2Y), AutoSize = true });
            txtChave = new TextBox { Location = new Point(250, linha2Y - 3), Size = new Size(280, 23) };
            grpFiltros.Controls.Add(txtChave);

            // Status
            grpFiltros.Controls.Add(new Label { Text = "Status", Location = new Point(540, linha2Y), AutoSize = true });
            cmbStatus = new ComboBox
            {
                Location = new Point(590, linha2Y - 3),
                Size = new Size(120, 23),
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            cmbStatus.Items.AddRange(new object[] { "Todos", "Lançada", "Pendente" });
            cmbStatus.SelectedIndex = 0;
            grpFiltros.Controls.Add(cmbStatus);

            // Usuário
            grpFiltros.Controls.Add(new Label { Text = "Usuário", Location = new Point(720, linha2Y), AutoSize = true });
            txtUsuario = new TextBox { Location = new Point(780, linha2Y - 3), Size = new Size(120, 23) };
            grpFiltros.Controls.Add(txtUsuario);

            // Botões
            btnPesquisar = new Button
            {
                Text = "Pesquisar",
                Location = new Point(910, 25),
                Size = new Size(90, 30),
                BackColor = Color.FromArgb(200, 16, 46),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnPesquisar.Click += async (s, e) => await PesquisarAsync();
            grpFiltros.Controls.Add(btnPesquisar);

            btnExportarCsv = new Button
            {
                Text = "Exportar CSV",
                Location = new Point(910, 60),
                Size = new Size(90, 30),
                Enabled = false
            };
            btnExportarCsv.Click += BtnExportarCsv_Click;
            grpFiltros.Controls.Add(btnExportarCsv);

            // Estatísticas
            lblEstatisticas = new Label
            {
                Text = "Nenhuma consulta realizada.",
                Location = new Point(10, 185),
                AutoSize = true,
                Font = new Font("Segoe UI", 9F, FontStyle.Regular),
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
            };
            Controls.Add(lblEstatisticas);

            // Grid de resultados
            gridResultados = new DataGridView
            {
                Location = new Point(10, 210),
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
                ReadOnly = true,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                BackgroundColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = false,
                ShowCellToolTips = true // Habilitar tooltips
            };
            gridResultados.CellContentClick += GridResultados_CellContentClick;
            Controls.Add(gridResultados);
        }

        private async Task PesquisarAsync()
        {
            try
            {
                btnPesquisar.Enabled = false;
                gridResultados.DataSource = null;
                dadosAtuais.Clear();

                var baseUrl = $"http://{ConfigManager.ApiHost}:{ConfigManager.Port}";

                var status = cmbStatus.SelectedIndex switch
                {
                    1 => "lancada",
                    2 => "pendente",
                    _ => string.Empty
                };

                var queryParams = new List<string>();
                queryParams.Add($"data_inicial={Uri.EscapeDataString(txtDataInicial.Text)}");
                queryParams.Add($"data_final={Uri.EscapeDataString(txtDataFinal.Text)}");
                if (!string.IsNullOrWhiteSpace(txtCnpj.Text)) queryParams.Add($"cnpj={Uri.EscapeDataString(txtCnpj.Text)}");
                if (!string.IsNullOrWhiteSpace(txtRazao.Text)) queryParams.Add($"razao={Uri.EscapeDataString(txtRazao.Text)}");
                if (!string.IsNullOrWhiteSpace(txtNumero.Text)) queryParams.Add($"numero={Uri.EscapeDataString(txtNumero.Text)}");
                if (!string.IsNullOrWhiteSpace(txtChave.Text)) queryParams.Add($"chave={Uri.EscapeDataString(txtChave.Text)}");
                if (!string.IsNullOrWhiteSpace(txtUsuario.Text)) queryParams.Add($"usuario={Uri.EscapeDataString(txtUsuario.Text)}");
                if (!string.IsNullOrEmpty(status)) queryParams.Add($"status={Uri.EscapeDataString(status)}");

                var url = $"{baseUrl}/consulta?{string.Join("&", queryParams)}";

                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    var mensagemErro = response.StatusCode switch
                    {
                        System.Net.HttpStatusCode.NotFound => 
                            $"Servidor não encontrado em {baseUrl}.\n\n" +
                            $"Verifique se:\n" +
                            $"1. O servidor Node.js está rodando (node server.js)\n" +
                            $"2. A porta {ConfigManager.Port} está correta no config.env\n" +
                            $"3. O host '{ConfigManager.ApiHost}' está acessível",
                        System.Net.HttpStatusCode.ServiceUnavailable =>
                            $"Servidor indisponível em {baseUrl}.\n\nVerifique se o servidor Node.js está rodando.",
                        _ =>
                            $"Erro ao consultar NF-e: {response.StatusCode}\n\nURL: {url}"
                    };
                    MessageBox.Show(mensagemErro, "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                using var stream = await response.Content.ReadAsStreamAsync();
                using var doc = await JsonDocument.ParseAsync(stream);

                if (!doc.RootElement.TryGetProperty("data", out var dataElement) || dataElement.ValueKind != JsonValueKind.Array)
                {
                    MessageBox.Show("Resposta inesperada do servidor.", "Atenção", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                var table = new DataTable();
                table.Columns.Add("Emissão", typeof(string));
                table.Columns.Add("CNPJ/CPF", typeof(string));
                table.Columns.Add("Razão Social", typeof(string));
                table.Columns.Add("Chave", typeof(string));
                table.Columns.Add("Valor", typeof(string));
                table.Columns.Add("Número NF", typeof(string));
                table.Columns.Add("Status", typeof(string));
                table.Columns.Add("Detalhes", typeof(string));
                table.Columns.Add("DANFE", typeof(string));
                table.Columns.Add("XML", typeof(string));
                table.Columns.Add("Copiar", typeof(string));

                decimal valorTotal = 0;
                int lancadas = 0;
                int pendentes = 0;

                foreach (var item in dataElement.EnumerateArray())
                {
                    dadosAtuais.Add(item.Clone());

                    var emissao = ObterString(item, "EMISSAO_NORMALIZADA") ?? "";
                    var cnpjCpf = ObterString(item, "CNPJ_CPF") ?? "";
                    var razao = ObterString(item, "RAZAO") ?? "";
                    var chave = ObterString(item, "CHAVE") ?? "";
                    var valor = ObterDecimal(item, "VALOR");
                    var numero = ObterString(item, "NUMERO_NF") ?? "";
                    var lancada = ObterInt32(item, "LANCADA") == 1;

                    valorTotal += valor;
                    if (lancada) lancadas++; else pendentes++;

                    var statusTexto = lancada ? "Lançada" : "Pendente";
                    var valorFormatado = valor.ToString("C", new System.Globalization.CultureInfo("pt-BR"));
                    var cnpjFormatado = FormatarDocumento(cnpjCpf);
                    var emissaoFormatada = FormatarData(emissao);

                    // Adicionar botões apenas se tiver chave
                    var temChave = !string.IsNullOrEmpty(chave);
                    table.Rows.Add(
                        emissaoFormatada, 
                        cnpjFormatado, 
                        razao, 
                        chave, 
                        valorFormatado, 
                        numero, 
                        statusTexto,
                        temChave ? "🔍" : "",  // Ícone Detalhes
                        temChave ? "📄" : "",  // Ícone DANFE
                        temChave ? "📥" : "",  // Ícone XML
                        temChave ? "📋" : ""   // Ícone Copiar
                    );
                }

                gridResultados.DataSource = table;
                
                // Configurar colunas de botões
                ConfigurarBotoesGrid();

                // Atualizar estatísticas
                lblEstatisticas.Text = $"Total: {dadosAtuais.Count} nota(s) | Valor Total: {valorTotal.ToString("C", new System.Globalization.CultureInfo("pt-BR"))} | Lançadas: {lancadas} | Pendentes: {pendentes}";
                btnExportarCsv.Enabled = dadosAtuais.Count > 0;
            }
            catch (HttpRequestException ex)
            {
                var mensagem = $"Não foi possível conectar ao servidor em http://{ConfigManager.ApiHost}:{ConfigManager.Port}.\n\n" +
                              $"Verifique se:\n" +
                              $"1. O servidor Node.js está rodando (execute: node server.js)\n" +
                              $"2. A porta {ConfigManager.Port} está correta no config.env\n" +
                              $"3. O host '{ConfigManager.ApiHost}' está correto\n\n" +
                              $"Erro detalhado: {ex.Message}";
                MessageBox.Show(mensagem, "Erro de Conexão", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erro ao consultar NF-e: {ex.Message}\n\nTipo: {ex.GetType().Name}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                btnPesquisar.Enabled = true;
            }
        }

        private void ConfigurarBotoesGrid()
        {
            // Mapeamento de colunas para ícones e tooltips
            var colunasConfig = new Dictionary<string, (string icone, string tooltip)>
            {
                { "Detalhes", ("🔍", "Ver detalhes da NF-e") },
                { "DANFE", ("📄", "Visualizar/Imprimir DANFE") },
                { "XML", ("📥", "Baixar XML da NF-e") },
                { "Copiar", ("📋", "Copiar chave de acesso") }
            };
            
            foreach (var config in colunasConfig)
            {
                var nomeColuna = config.Key;
                var colunaExistente = gridResultados.Columns[nomeColuna];
                if (colunaExistente != null)
                {
                    var index = colunaExistente.Index;
                    
                    // Remover coluna existente
                    gridResultados.Columns.Remove(colunaExistente);
                    
                    // Criar coluna de botão com ícone
                    var btnCol = new DataGridViewButtonColumn
                    {
                        Name = nomeColuna,
                        HeaderText = "", // Sem cabeçalho para economizar espaço
                        Text = config.Value.icone,
                        UseColumnTextForButtonValue = true,
                        FlatStyle = FlatStyle.Flat,
                        Width = 35, // Largura menor para ícones
                        DefaultCellStyle = new DataGridViewCellStyle
                        {
                            Alignment = DataGridViewContentAlignment.MiddleCenter,
                            BackColor = Color.FromArgb(250, 250, 250),
                            SelectionBackColor = Color.FromArgb(230, 230, 230),
                            Font = new Font("Segoe UI Emoji", 10F) // Fonte que suporta emojis
                        }
                    };
                    
                    // Inserir na posição original
                    gridResultados.Columns.Insert(index, btnCol);
                }
            }
            
            // Configurar tooltips
            gridResultados.CellToolTipTextNeeded += GridResultados_CellToolTipTextNeeded;
        }
        
        private void GridResultados_CellToolTipTextNeeded(object sender, DataGridViewCellToolTipTextNeededEventArgs e)
        {
            if (e.RowIndex < 0 || e.ColumnIndex < 0) return;
            
            var coluna = gridResultados.Columns[e.ColumnIndex];
            var nomeColuna = coluna.Name;
            
            var tooltips = new Dictionary<string, string>
            {
                { "Detalhes", "Ver detalhes da NF-e" },
                { "DANFE", "Visualizar/Imprimir DANFE" },
                { "XML", "Baixar XML da NF-e" },
                { "Copiar", "Copiar chave de acesso" }
            };
            
            if (tooltips.TryGetValue(nomeColuna, out var tooltip))
            {
                // Verificar se a célula tem conteúdo (ícone)
                var cellValue = gridResultados.Rows[e.RowIndex].Cells[e.ColumnIndex].Value?.ToString();
                if (!string.IsNullOrEmpty(cellValue))
                {
                    e.ToolTipText = tooltip;
                }
            }
        }

        private void GridResultados_CellContentClick(object sender, DataGridViewCellEventArgs e)
        {
            if (e.RowIndex < 0 || e.ColumnIndex < 0) return;
            if (e.RowIndex >= dadosAtuais.Count) return;

            var coluna = gridResultados.Columns[e.ColumnIndex];
            var nomeColuna = coluna.Name;

            // Só processar se for uma coluna de botão
            var colunasBotoes = new[] { "Detalhes", "DANFE", "XML", "Copiar" };
            if (!colunasBotoes.Contains(nomeColuna)) return;

            // Obter chave da linha
            var chave = ObterString(dadosAtuais[e.RowIndex], "CHAVE");
            if (string.IsNullOrEmpty(chave))
            {
                MessageBox.Show("Esta nota não possui chave de acesso.", "Atenção", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            // Executar ação baseada no botão clicado
            switch (nomeColuna)
            {
                case "Detalhes":
                    _ = AbrirDetalhesAsync(chave);
                    break;
                case "DANFE":
                    _ = BaixarDanfeAsync(chave);
                    break;
                case "XML":
                    _ = BaixarXmlAsync(chave);
                    break;
                case "Copiar":
                    CopiarChave(chave);
                    break;
            }
        }

        private async Task AbrirDetalhesAsync(string chave)
        {
            try
            {
                var formDetalhes = new Form
                {
                    Text = $"Detalhes NF-e - {chave}",
                    WindowState = FormWindowState.Maximized,
                    StartPosition = FormStartPosition.CenterScreen
                };

                var detalhes = new UcDetalhesNFe(chave)
                {
                    Dock = DockStyle.Fill
                };

                formDetalhes.Controls.Add(detalhes);
                formDetalhes.ShowDialog();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erro ao abrir detalhes: {ex.Message}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private async Task BaixarDanfeAsync(string chave)
        {
            try
            {
                var baseUrl = $"http://{ConfigManager.ApiHost}:{ConfigManager.Port}";
                var url = $"{baseUrl}/danfe/{chave}";

                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    var erro = await response.Content.ReadAsStringAsync();
                    MessageBox.Show($"Erro ao baixar DANFE: {response.StatusCode}\n\n{erro}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                var bytes = await response.Content.ReadAsByteArrayAsync();
                
                // Abrir PDF diretamente (imprimir)
                var tempPath = Path.Combine(Path.GetTempPath(), $"danfe-{chave}.pdf");
                await File.WriteAllBytesAsync(tempPath, bytes);
                
                // Abrir com o visualizador padrão do Windows
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = tempPath,
                    UseShellExecute = true
                });
                
                MessageBox.Show("DANFE aberto para visualização/impressão!", "Sucesso", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erro ao abrir DANFE: {ex.Message}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private async Task BaixarXmlAsync(string chave)
        {
            try
            {
                var baseUrl = $"http://{ConfigManager.ApiHost}:{ConfigManager.Port}";
                var url = $"{baseUrl}/xml/{chave}";

                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    MessageBox.Show("Erro ao baixar XML.", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                var bytes = await response.Content.ReadAsByteArrayAsync();
                var saveDialog = new SaveFileDialog
                {
                    FileName = $"nfe-{chave}.xml",
                    Filter = "XML Files|*.xml"
                };

                if (saveDialog.ShowDialog() == DialogResult.OK)
                {
                    await File.WriteAllBytesAsync(saveDialog.FileName, bytes);
                    MessageBox.Show("XML baixado com sucesso!", "Sucesso", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erro ao baixar XML: {ex.Message}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void BtnExportarCsv_Click(object sender, EventArgs e)
        {
            if (dadosAtuais.Count == 0)
            {
                MessageBox.Show("Nenhum dado para exportar.", "Atenção", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var saveDialog = new SaveFileDialog
            {
                FileName = $"consulta-nfe-{DateTime.Now:yyyyMMdd}.csv",
                Filter = "CSV Files|*.csv"
            };

            if (saveDialog.ShowDialog() != DialogResult.OK) return;

            try
            {
                var sb = new StringBuilder();
                sb.AppendLine("Emissão;CNPJ/CPF;Razão Social;Chave;Valor;Número NF;Status");

                foreach (var item in dadosAtuais)
                {
                    var emissao = ObterString(item, "EMISSAO_NORMALIZADA") ?? "";
                    var cnpjCpf = ObterString(item, "CNPJ_CPF") ?? "";
                    var razao = ObterString(item, "RAZAO") ?? "";
                    var chave = ObterString(item, "CHAVE") ?? "";
                    var valor = ObterDecimal(item, "VALOR");
                    var numero = ObterString(item, "NUMERO_NF") ?? "";
                    var lancada = ObterInt32(item, "LANCADA") == 1;
                    var status = lancada ? "Lançada" : "Pendente";

                    sb.AppendLine($"{FormatarData(emissao)};{cnpjCpf};{razao};{chave};{valor.ToString("F2", new System.Globalization.CultureInfo("pt-BR"))};{numero};{status}");
                }

                File.WriteAllText(saveDialog.FileName, sb.ToString(), Encoding.UTF8);
                MessageBox.Show("CSV exportado com sucesso!", "Sucesso", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erro ao exportar CSV: {ex.Message}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private string FormatarDocumento(string documento)
        {
            if (string.IsNullOrEmpty(documento)) return "-";
            var digits = Regex.Replace(documento, @"\D", "");
            if (digits.Length == 14)
                return $"{digits.Substring(0, 2)}.{digits.Substring(2, 3)}.{digits.Substring(5, 3)}/{digits.Substring(8, 4)}-{digits.Substring(12)}";
            if (digits.Length == 11)
                return $"{digits.Substring(0, 3)}.{digits.Substring(3, 3)}.{digits.Substring(6, 3)}-{digits.Substring(9)}";
            return documento;
        }

        private void CopiarChave(string chave)
        {
            try
            {
                Clipboard.SetText(chave);
                MessageBox.Show("Chave copiada para a área de transferência!", "Sucesso", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erro ao copiar chave: {ex.Message}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private string FormatarData(string data)
        {
            if (string.IsNullOrEmpty(data)) return "-";
            if (DateTime.TryParse(data, out var dt))
                return dt.ToString("dd/MM/yyyy");
            return data;
        }

        private string ObterString(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var prop)) return null;
            if (prop.ValueKind == JsonValueKind.Null) return null;
            return prop.GetString();
        }

        private decimal ObterDecimal(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var prop)) return 0;
            if (prop.ValueKind == JsonValueKind.Null) return 0;
            
            if (prop.ValueKind == JsonValueKind.Number)
                return prop.GetDecimal();
            
            if (prop.ValueKind == JsonValueKind.String)
            {
                var str = prop.GetString();
                if (decimal.TryParse(str, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var result))
                    return result;
            }
            
            return 0;
        }

        private int ObterInt32(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var prop)) return 0;
            if (prop.ValueKind == JsonValueKind.Null) return 0;
            
            if (prop.ValueKind == JsonValueKind.Number)
                return prop.GetInt32();
            
            if (prop.ValueKind == JsonValueKind.String)
            {
                var str = prop.GetString();
                if (int.TryParse(str, out var result))
                    return result;
            }
            
            return 0;
        }
    }
}
