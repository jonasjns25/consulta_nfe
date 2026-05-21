using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SACGerencial
{
    /// <summary>
    /// Tela de detalhes da NF-e com comparação XML vs ERP.
    /// </summary>
    public class UcDetalhesNFe : UserControl
    {
        private readonly string chave;
        private readonly HttpClient httpClient = new HttpClient();
        private readonly Panel pnlConteudo;
        private readonly Label lblCarregando;
        private readonly Dictionary<int, Dictionary<string, object>> produtosData = new Dictionary<int, Dictionary<string, object>>();
        private readonly Dictionary<int, bool> flagODA = new Dictionary<int, bool>();
        private JsonDocument? jsonDocument; // Manter o documento JSON vivo

        public UcDetalhesNFe(string chave)
        {
            this.chave = chave;
            Dock = DockStyle.Fill;
            BackColor = Color.White;
            Padding = new Padding(10);

            // Label de carregamento
            lblCarregando = new Label
            {
                Text = "Carregando detalhes da NF-e...",
                Font = new Font("Segoe UI", 12F),
                AutoSize = true,
                Location = new Point(10, 10)
            };
            Controls.Add(lblCarregando);

            // Painel de conteúdo (será preenchido após carregar dados)
            pnlConteudo = new Panel
            {
                Dock = DockStyle.Fill,
                AutoScroll = true,
                Visible = false
            };
            Controls.Add(pnlConteudo);

            // Carregar dados
            _ = CarregarDetalhesAsync();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                jsonDocument?.Dispose();
                httpClient?.Dispose();
            }
            base.Dispose(disposing);
        }

        private async Task CarregarDetalhesAsync()
        {
            try
            {
                var baseUrl = $"http://{ConfigManager.ApiHost}:{ConfigManager.Port}";
                var url = $"{baseUrl}/detalhes/{chave}";

                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    lblCarregando.Text = "Erro ao carregar detalhes da NF-e.";
                    lblCarregando.ForeColor = Color.Red;
                    return;
                }

                using var stream = await response.Content.ReadAsStreamAsync();
                // Manter o documento JSON vivo para que os JsonElement funcionem
                jsonDocument = await JsonDocument.ParseAsync(stream);

                lblCarregando.Visible = false;
                pnlConteudo.Visible = true;

                ExibirDetalhes(jsonDocument.RootElement);
            }
            catch (Exception ex)
            {
                lblCarregando.Text = $"Erro: {ex.Message}";
                lblCarregando.ForeColor = Color.Red;
            }
        }

        private void ExibirDetalhes(JsonElement dados)
        {
            int y = 10;

            // Informações da NF-e
            var grpInfo = new GroupBox
            {
                Text = "Informações da NF-e",
                Location = new Point(10, y),
                Height = 150,
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
            };
            grpInfo.Width = pnlConteudo.Width - 40;
            pnlConteudo.Controls.Add(grpInfo);

            y = 25;
            AdicionarInfo(grpInfo, "Chave de Acesso", ObterString(dados, "chave"), 10, y);
            AdicionarInfo(grpInfo, "Número", ObterString(dados, "numero"), 300, y);
            AdicionarInfo(grpInfo, "Série", ObterString(dados, "serie"), 500, y);
            y += 30;
            AdicionarInfo(grpInfo, "Data de Emissão", ObterString(dados, "dataEmissao"), 10, y);
            AdicionarInfo(grpInfo, "Modelo", ObterString(dados, "modelo"), 300, y);
            AdicionarInfo(grpInfo, "Natureza da Operação", ObterString(dados, "naturezaOperacao"), 500, y);
            y += 30;
            var emitente = dados.GetProperty("emitente");
            AdicionarInfo(grpInfo, "Emitente", ObterString(emitente, "nome"), 10, y);
            AdicionarInfo(grpInfo, "CNPJ Emitente", ObterString(emitente, "cnpj"), 300, y);
            var destinatario = dados.GetProperty("destinatario");
            AdicionarInfo(grpInfo, "Destinatário", ObterString(destinatario, "nome"), 600, y);

            // Botões de ação no cabeçalho
            var chaveNFe = ObterString(dados, "chave");
            var btnY = 25;
            var btnX = grpInfo.Width - 350;
            
            var btnDanfe = new Button
            {
                Text = "📄 DANFE",
                Location = new Point(btnX, btnY),
                Size = new Size(100, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(200, 16, 46),
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            btnDanfe.Click += async (s, e) => await BaixarDanfeAsync(chaveNFe);
            grpInfo.Controls.Add(btnDanfe);

            var btnXml = new Button
            {
                Text = "📥 XML",
                Location = new Point(btnX + 110, btnY),
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(200, 16, 46),
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            btnXml.Click += async (s, e) => await BaixarXmlAsync(chaveNFe);
            grpInfo.Controls.Add(btnXml);

            var btnCopiar = new Button
            {
                Text = "📋 Copiar",
                Location = new Point(btnX + 200, btnY),
                Size = new Size(90, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(200, 16, 46),
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            btnCopiar.Click += (s, e) => CopiarChave(chaveNFe);
            grpInfo.Controls.Add(btnCopiar);

            y += 100;

            // Totais
            var grpTotais = new GroupBox
            {
                Text = "Totais da NF-e",
                Location = new Point(10, y),
                Height = 100,
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
            };
            grpTotais.Width = pnlConteudo.Width - 40;
            pnlConteudo.Controls.Add(grpTotais);

            var totais = dados.GetProperty("totais");
            int x = 10;
            int linhaY = 25;
            AdicionarTotal(grpTotais, "Valor Total dos Produtos", ObterDecimal(totais, "valorTotalProdutos"), x, linhaY);
            x += 200;
            AdicionarTotal(grpTotais, "Valor do ICMS", ObterDecimal(totais, "valorICMS"), x, linhaY);
            x += 200;
            AdicionarTotal(grpTotais, "Valor do IPI", ObterDecimal(totais, "valorIPI"), x, linhaY);
            x += 200;
            AdicionarTotal(grpTotais, "Valor Total da NF-e", ObterDecimal(totais, "valorNF"), x, linhaY);

            y += 120;

            // Produtos - DataGridView com todas as colunas
            var produtos = dados.GetProperty("produtos");
            var grpProdutos = new GroupBox
            {
                Text = $"Produtos ({produtos.GetArrayLength()} item(s))",
                Location = new Point(10, y),
                Height = 500,
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
            };
            grpProdutos.Width = pnlConteudo.Width - 40;
            pnlConteudo.Controls.Add(grpProdutos);

            var gridProdutos = new DataGridView
            {
                Location = new Point(10, 25),
                Width = grpProdutos.Width - 20,
                Height = grpProdutos.Height - 240, // Deixar espaço para painel de detalhes
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                ReadOnly = true,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = false,
                RowHeadersVisible = false,
                BackgroundColor = Color.White,
                BorderStyle = BorderStyle.None,
                CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal,
                GridColor = Color.FromArgb(230, 230, 230)
            };
            grpProdutos.Controls.Add(gridProdutos);

            // Configurar colunas
            gridProdutos.Columns.Add("Expandir", "");
            gridProdutos.Columns.Add("Item", "Item");
            gridProdutos.Columns.Add("Codigo", "Código");
            gridProdutos.Columns.Add("EAN", "EAN");
            gridProdutos.Columns.Add("Descricao", "Descrição");
            gridProdutos.Columns.Add("NCM", "NCM");
            gridProdutos.Columns.Add("CFOP", "CFOP");
            gridProdutos.Columns.Add("CST", "CST");
            gridProdutos.Columns.Add("Unidade", "Un.");
            gridProdutos.Columns.Add("Quantidade", "Qtd");
            gridProdutos.Columns.Add("ValorUnit", "Vl. Unit.");
            gridProdutos.Columns.Add("ValorTotal", "Vl. Total");
            gridProdutos.Columns.Add("BaseCalculo", "Base de Cálculo");
            gridProdutos.Columns.Add("Aliquota", "Alíquota");
            gridProdutos.Columns.Add("ICMS", "ICMS");
            gridProdutos.Columns.Add("IPI", "IPI");

            // Configurar larguras das colunas
            gridProdutos.Columns["Expandir"].Width = 40;
            gridProdutos.Columns["Item"].Width = 50;
            gridProdutos.Columns["Codigo"].Width = 80;
            gridProdutos.Columns["EAN"].Width = 120;
            gridProdutos.Columns["Descricao"].Width = 300;
            gridProdutos.Columns["NCM"].Width = 100;
            gridProdutos.Columns["CFOP"].Width = 70;
            gridProdutos.Columns["CST"].Width = 50;
            gridProdutos.Columns["Unidade"].Width = 50;
            gridProdutos.Columns["Quantidade"].Width = 80;
            gridProdutos.Columns["ValorUnit"].Width = 90;
            gridProdutos.Columns["ValorTotal"].Width = 100;
            gridProdutos.Columns["BaseCalculo"].Width = 110;
            gridProdutos.Columns["Aliquota"].Width = 80;
            gridProdutos.Columns["ICMS"].Width = 90;
            gridProdutos.Columns["IPI"].Width = 90;

            // Configurar alinhamento
            gridProdutos.Columns["Item"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleCenter;
            gridProdutos.Columns["Quantidade"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            gridProdutos.Columns["ValorUnit"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            gridProdutos.Columns["ValorTotal"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            gridProdutos.Columns["BaseCalculo"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            gridProdutos.Columns["Aliquota"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            gridProdutos.Columns["ICMS"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            gridProdutos.Columns["IPI"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;

            // Formato de moeda
            gridProdutos.Columns["ValorUnit"].DefaultCellStyle.Format = "C";
            gridProdutos.Columns["ValorTotal"].DefaultCellStyle.Format = "C";
            gridProdutos.Columns["BaseCalculo"].DefaultCellStyle.Format = "C";
            gridProdutos.Columns["ICMS"].DefaultCellStyle.Format = "C";
            gridProdutos.Columns["IPI"].DefaultCellStyle.Format = "C";

            // Formato de percentual (já formatado como string com %)
            gridProdutos.Columns["Aliquota"].DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;

            // Adicionar coluna de botão para expandir
            var btnColExpandir = new DataGridViewButtonColumn
            {
                Name = "Expandir",
                HeaderText = "",
                Text = "+",
                UseColumnTextForButtonValue = true,
                Width = 40,
                FlatStyle = FlatStyle.Flat
            };
            gridProdutos.Columns.Remove("Expandir");
            gridProdutos.Columns.Insert(0, btnColExpandir);

            // Preencher dados
            foreach (var produto in produtos.EnumerateArray())
            {
                var produtoDict = ConverterJsonElementParaDict(produto);
                var item = ObterInt32(produtoDict, "item");
                produtosData[item] = produtoDict;
                flagODA[item] = true;

                var temErro = ItemTemErro(produtoDict, flagODA[item]);
                var codigo = ObterString(produtoDict, "codigo") ?? "-";
                
                // Formatar EAN (mostrar ambos se forem diferentes)
                var eanComercial = ObterString(produtoDict, "eanComercial") ?? "";
                var eanTributavel = ObterString(produtoDict, "eanTributavel") ?? "";
                string ean;
                if (!string.IsNullOrEmpty(eanComercial) && !string.IsNullOrEmpty(eanTributavel) && eanComercial == eanTributavel)
                {
                    ean = eanComercial;
                }
                else if (!string.IsNullOrEmpty(eanComercial) && !string.IsNullOrEmpty(eanTributavel))
                {
                    ean = $"{eanComercial} / {eanTributavel}";
                }
                else
                {
                    ean = eanComercial ?? eanTributavel ?? "-";
                }
                
                var descricao = ObterString(produtoDict, "descricao") ?? "-";
                var ncm = ObterString(produtoDict, "ncm") ?? "-";
                var cfop = ObterString(produtoDict, "cfop") ?? "-";
                var cst = ObterString(produtoDict, "icmsCST") ?? "-";
                var unidade = ObterString(produtoDict, "unidade") ?? "-";
                var quantidade = ObterDecimal(produtoDict, "quantidade");
                var valorUnit = ObterDecimal(produtoDict, "valorUnitario");
                var valorTotal = ObterDecimal(produtoDict, "valorTotal");
                var baseCalculo = ObterDecimal(produtoDict, "baseCalculoICMS");
                var aliquota = ObterDecimal(produtoDict, "aliquotaICMS");
                var valorICMS = ObterDecimal(produtoDict, "valorICMS");
                var valorIPI = ObterDecimal(produtoDict, "valorIPI");

                // Formatar item com badge de status
                var itemComBadge = temErro ? $"{item} !" : $"{item} ✓";
                
                // Formatar alíquota com percentual
                var aliquotaFormatada = $"{aliquota:F2}%";
                
                var row = new object[]
                {
                    "+", // Botão expandir
                    itemComBadge,
                    codigo,
                    ean,
                    descricao,
                    ncm,
                    cfop,
                    cst,
                    unidade,
                    quantidade,
                    valorUnit,
                    valorTotal,
                    baseCalculo,
                    aliquotaFormatada,
                    valorICMS,
                    valorIPI
                };

                var rowIndex = gridProdutos.Rows.Add(row);
                var rowObj = gridProdutos.Rows[rowIndex];

                // Destacar linhas com erro
                if (temErro)
                {
                    rowObj.DefaultCellStyle.BackColor = Color.FromArgb(255, 240, 240);
                    rowObj.DefaultCellStyle.ForeColor = Color.DarkRed;
                    // Badge de erro na coluna Item
                    rowObj.Cells["Item"].Style.ForeColor = Color.Red;
                    rowObj.Cells["Item"].Style.Font = new Font(gridProdutos.Font, FontStyle.Bold);
                }
                else
                {
                    // Badge de OK na coluna Item
                    rowObj.Cells["Item"].Style.ForeColor = Color.Green;
                }

                // Armazenar o item na tag da linha para uso no evento de clique
                rowObj.Tag = item;
            }

            // Painel para detalhes (inicialmente oculto) - posicionado abaixo da grid
            var pnlDetalhesProduto = new Panel
            {
                Location = new Point(10, grpProdutos.Height - 210),
                Width = grpProdutos.Width - 20,
                Height = 200,
                Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.FromArgb(250, 250, 250),
                AutoScroll = true,
                Visible = false
            };
            grpProdutos.Controls.Add(pnlDetalhesProduto);

            // Evento para expandir detalhes
            gridProdutos.CellContentClick += (s, e) =>
            {
                if (e.ColumnIndex == 0 && e.RowIndex >= 0) // Coluna "Expandir"
                {
                    var row = gridProdutos.Rows[e.RowIndex];
                    var item = (int)row.Tag;
                    var btnCell = row.Cells[0] as DataGridViewButtonCell;
                    
                    if (!produtosData.TryGetValue(item, out var produto)) return;

                    // Alternar entre + e -
                    if (btnCell.Value.ToString() == "+")
                    {
                        btnCell.Value = "−";
                        // Mostrar painel de detalhes
                        pnlDetalhesProduto.Controls.Clear();
                        CriarPainelDetalhesItem(produto, pnlDetalhesProduto);
                        pnlDetalhesProduto.Visible = true;
                        pnlDetalhesProduto.BringToFront();
                    }
                    else
                    {
                        btnCell.Value = "+";
                        // Ocultar painel de detalhes
                        pnlDetalhesProduto.Visible = false;
                    }
                }
            };
        }

        private void ToggleDetalhesItem(int item, Button btnExpandir, Panel pnlItem)
        {
            var detalhesPanel = pnlItem.Controls.OfType<Panel>().FirstOrDefault(p => p.Name == $"detalhes_{item}");
            
            if (detalhesPanel != null)
            {
                // Remover detalhes
                pnlItem.Controls.Remove(detalhesPanel);
                detalhesPanel.Dispose();
                btnExpandir.Text = "+";
                pnlItem.Height = 40;
            }
            else
            {
                // Adicionar detalhes
                if (!produtosData.TryGetValue(item, out var produto)) return;

                detalhesPanel = new Panel
                {
                    Name = $"detalhes_{item}",
                    Location = new Point(0, 40),
                    Width = pnlItem.Width,
                    Height = 400,
                    BorderStyle = BorderStyle.FixedSingle,
                    BackColor = Color.FromArgb(250, 250, 250),
                    AutoScroll = true
                };

                CriarPainelDetalhesItem(produto, detalhesPanel);
                pnlItem.Controls.Add(detalhesPanel);
                pnlItem.Height = 440;
                btnExpandir.Text = "−";
            }

            // Ajustar posição dos próximos itens
            AjustarPosicoesItens(pnlItem.Parent);
        }

        private void CriarPainelDetalhesItem(Dictionary<string, object> produto, Panel pnlDetalhes)
        {
            int y = 10;
            Dictionary<string, object> dadosERP = null;
            if (produto.TryGetValue("dadosERP", out var erpObj) && erpObj != null)
            {
                if (erpObj is Dictionary<string, object> erpDict)
                    dadosERP = erpDict;
                else if (erpObj is JsonElement erpJson && erpJson.ValueKind != JsonValueKind.Null)
                    dadosERP = ConverterJsonElementParaDict(erpJson);
            }

            // Informações do Produto
            var grpProduto = new GroupBox
            {
                Text = "Informações do Produto",
                Location = new Point(10, y),
                Width = pnlDetalhes.Width - 30,
                Height = 200
            };
            pnlDetalhes.Controls.Add(grpProduto);
            CriarComparacaoProduto(produto, dadosERP, grpProduto);
            y += 210;

            // ICMS
            var grpICMS = new GroupBox
            {
                Text = "ICMS",
                Location = new Point(10, y),
                Width = pnlDetalhes.Width - 30,
                Height = 300
            };
            pnlDetalhes.Controls.Add(grpICMS);
            CriarComparacaoICMS(produto, dadosERP, grpICMS);
            y += 310;

            // IPI (se houver)
            if (ObterDecimal(produto, "valorIPI") > 0)
            {
                var grpIPI = new GroupBox
                {
                    Text = "IPI",
                    Location = new Point(10, y),
                    Width = pnlDetalhes.Width - 30,
                    Height = 150
                };
                pnlDetalhes.Controls.Add(grpIPI);
                CriarComparacaoIPI(produto, dadosERP, grpIPI);
            }
        }

        private void CriarComparacaoProduto(Dictionary<string, object> produto, Dictionary<string, object> dadosERP, GroupBox grupo)
        {
            int y = 20;
            var item = ObterInt32(produto, "item");

            // Código
            var codigoXML = ObterString(produto, "codigo") ?? "";
            var codigoERP = BuscarCampoERP(dadosERP, "reffor", "REFFOR");
            var igualCodigo = CompararValores(codigoXML, codigoERP);
            AdicionarComparacao(grupo, "Código", codigoXML, codigoERP?.ToString() ?? "-", igualCodigo, 10, y);
            y += 25;

            // EAN
            var eanComercial = ObterString(produto, "eanComercial") ?? "";
            var eanTributavel = ObterString(produto, "eanTributavel") ?? "";
            if (eanComercial == eanTributavel && !string.IsNullOrEmpty(eanComercial))
            {
                AdicionarComparacao(grupo, "EAN", eanComercial, "-", true, 10, y);
            }
            else
            {
                if (!string.IsNullOrEmpty(eanComercial))
                {
                    AdicionarComparacao(grupo, "EAN Comercial", eanComercial, "-", true, 10, y);
                    y += 25;
                }
                if (!string.IsNullOrEmpty(eanTributavel))
                {
                    AdicionarComparacao(grupo, "EAN Tributável", eanTributavel, "-", true, 10, y);
                }
            }
            y += 25;

            // Quantidade Tributável
            var qtdXML = ObterDecimal(produto, "quantidadeTrib");
            var qtdERP = CalcularQuantidadeTributavelERP(dadosERP);
            var igualQtd = CompararValores(qtdXML, qtdERP);
            AdicionarComparacao(grupo, "Quantidade Tributável", qtdXML.ToString("F4"), qtdERP?.ToString("F4") ?? "-", igualQtd, 10, y);
            y += 25;

            // Valor Unit. Tributável
            var valorUnitXML = ObterDecimal(produto, "valorUnitarioTrib");
            var valorUnitERP = CalcularValorUnitarioTributavelERP(dadosERP);
            var igualValorUnit = CompararValores(valorUnitXML, valorUnitERP);
            AdicionarComparacao(grupo, "Valor Unit. Tributável", valorUnitXML.ToString("C"), valorUnitERP?.ToString("C") ?? "-", igualValorUnit, 10, y);
            y += 25;

            // Valor Desconto
            var descontoXML = ObterDecimal(produto, "valorDesconto");
            var descontoERP = CalcularValorDescontoERP(dadosERP);
            var igualDesconto = CompararValores(descontoXML, descontoERP);
            AdicionarComparacao(grupo, "Valor Desconto", descontoXML.ToString("C"), descontoERP?.ToString("C") ?? "-", igualDesconto, 10, y);
            y += 25;

            // Valor Outros (ODA)
            var outrosXML = ObterDecimal(produto, "valorOutros");
            var outrosERP = CalcularValorOutrosERP(dadosERP);
            var igualOutros = CompararValores(outrosXML, outrosERP);
            AdicionarComparacao(grupo, "Valor Outros", outrosXML.ToString("C"), outrosERP?.ToString("C") ?? "-", igualOutros, 10, y);
            y += 25;

            // Flag ODA
            var chkODA = new CheckBox
            {
                Text = "Somar ODA nas bases de cálculo",
                Location = new Point(10, y),
                Checked = flagODA[item],
                AutoSize = true
            };
            chkODA.CheckedChanged += (s, e) =>
            {
                flagODA[item] = chkODA.Checked;
                // Recriar painel de detalhes
                if (grupo.Parent is Panel pnlDetalhes)
                {
                    var itemNum = item;
                    pnlDetalhes.Controls.Clear();
                    if (produtosData.TryGetValue(itemNum, out var prod))
                    {
                        CriarPainelDetalhesItem(prod, pnlDetalhes);
                    }
                }
            };
            grupo.Controls.Add(chkODA);
        }

        private void CriarComparacaoICMS(Dictionary<string, object> produto, Dictionary<string, object> dadosERP, GroupBox grupo)
        {
            int y = 20;

            // Cabeçalhos das colunas
            var lblCampo = new Label
            {
                Text = "Campo:",
                Location = new Point(10, y),
                Width = 200,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(100, 100, 100),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(lblCampo);

            var lblXML = new Label
            {
                Text = "XML:",
                Location = new Point(210, y),
                Width = 180,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(100, 100, 100),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(lblXML);

            var lblERP = new Label
            {
                Text = "ERP:",
                Location = new Point(400, y),
                Width = 250,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(100, 100, 100),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(lblERP);

            // Linha separadora
            var linha = new Label
            {
                Text = "─────────────────────────────────────────────────────────────────────────────",
                Location = new Point(10, y + 18),
                Width = 700,
                Font = new Font("Segoe UI", 8F),
                ForeColor = Color.FromArgb(200, 200, 200),
                AutoSize = false
            };
            grupo.Controls.Add(linha);

            y += 40;

            // Exibir TODOS os campos do ICMS do XML
            // Origem
            var origXML = ObterString(produto, "icmsOrig") ?? "";
            if (!string.IsNullOrEmpty(origXML))
            {
                AdicionarInfoICMS(grupo, "Origem", origXML, 10, y);
                y += 25;
            }

            // CST
            var cstXML = ObterString(produto, "icmsCST") ?? "";
            var cstERP = CalcularCSTERP(dadosERP);
            var igualCST = CompararValores(cstXML, cstERP);
            AdicionarComparacao(grupo, "CST", cstXML, cstERP ?? "-", igualCST, 10, y);
            y += 25;

            // Modalidade de Base de Cálculo (modBC)
            var modBCXML = ObterString(produto, "icmsModBC") ?? "";
            if (!string.IsNullOrEmpty(modBCXML))
            {
                AdicionarInfoICMS(grupo, "Modalidade BC", modBCXML, 10, y);
                y += 25;
            }

            // Percentual de Redução da Base de Cálculo (pRedBC)
            // XML: percentual de REDUÇÃO (ex: 47,62%)
            // ERP: percentual RESTANTE (ex: 52,38%) - precisa converter: 100 - reducao = reducaoXML
            var pRedBCXML = ObterDecimal(produto, "icmsRedBC");
            if (pRedBCXML > 0)
            {
                var reducaoERP = BuscarCampoERP(dadosERP, "reducao", "REDUCAO");
                decimal? reducaoConvertidaERP = null;
                string textoERP = "-";
                bool igualReducao = false;

                if (reducaoERP != null)
                {
                    var reducaoNum = ConverterParaDecimal(reducaoERP) ?? 0;
                    // Converter: ERP armazena o percentual restante, XML armazena o percentual de redução
                    // Conversão: reducaoXML = 100 - reducaoERP
                    reducaoConvertidaERP = 100 - reducaoNum;
                    textoERP = $"{reducaoConvertidaERP.Value:F4}% (ERP: {reducaoNum:F4}% restante)";
                    igualReducao = CompararValores(pRedBCXML, reducaoConvertidaERP.Value);
                }

                // Label principal (alinhado com outras comparações)
                var lblReducao = new Label
                {
                    Text = "Percentual Redução BC (pRedBC):",
                    Location = new Point(10, y),
                    Width = 200,
                    Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
                    TextAlign = ContentAlignment.MiddleLeft
                };
                grupo.Controls.Add(lblReducao);

                // Valor XML (alinhado com coluna XML)
                var lblReducaoXML = new Label
                {
                    Text = $"{pRedBCXML:F4}%",
                    Location = new Point(210, y),
                    Width = 180,
                    Font = new Font("Segoe UI", 8.5F),
                    TextAlign = ContentAlignment.MiddleLeft
                };
                grupo.Controls.Add(lblReducaoXML);

                // Valor ERP (convertido) - alinhado com coluna ERP
                var lblReducaoERP = new Label
                {
                    Text = textoERP,
                    Location = new Point(400, y),
                    Width = 250,
                    Font = new Font("Segoe UI", 8.5F),
                    ForeColor = igualReducao ? Color.Green : (reducaoConvertidaERP == null ? Color.Gray : Color.Red),
                    TextAlign = ContentAlignment.MiddleLeft
                };
                grupo.Controls.Add(lblReducaoERP);

                // Indicador de erro (se houver divergência)
                if (reducaoConvertidaERP != null && !igualReducao)
                {
                    var lblErro = new Label
                    {
                        Text = "✗",
                        Location = new Point(660, y),
                        ForeColor = Color.Red,
                        Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                        AutoSize = true,
                        TextAlign = ContentAlignment.MiddleCenter
                    };
                    grupo.Controls.Add(lblErro);
                }

                // Nota explicativa (alinhada com o label, indentada)
                y += 25;
                var lblNota = new Label
                {
                    Text = "Nota: XML usa % de REDUÇÃO, ERP usa % RESTANTE. Conversão: Redução = 100% - Restante",
                    Location = new Point(30, y),
                    Width = 650,
                    Font = new Font("Segoe UI", 7.5F, FontStyle.Italic),
                    ForeColor = Color.FromArgb(100, 100, 100)
                };
                grupo.Controls.Add(lblNota);
                y += 20;
            }

            // Base de Cálculo (vBC)
            var baseXML = ObterDecimal(produto, "baseCalculoICMS");
            var baseERP = CalcularBaseCalculoICMSERP(dadosERP, flagODA[ObterInt32(produto, "item")]);
            var igualBase = CompararValores(baseXML, baseERP);
            AdicionarComparacao(grupo, "Base de Cálculo (vBC)", baseXML.ToString("C"), baseERP?.ToString("C") ?? "-", igualBase, 10, y);
            y += 25;

            // Alíquota (pICMS)
            var aliqXML = ObterDecimal(produto, "aliquotaICMS");
            var aliqERP = BuscarCampoERP(dadosERP, "aliquota", "ALIQUOTA");
            var igualAliq = CompararValores(aliqXML, aliqERP);
            AdicionarComparacao(grupo, "Alíquota (pICMS)", $"{aliqXML:F4}%", aliqERP != null ? $"{ConverterParaDecimal(aliqERP)?.ToString("F4") ?? "0.0000"}%" : "-", igualAliq, 10, y);
            y += 25;

            // Valor ICMS (vICMS)
            var valorXML = ObterDecimal(produto, "valorICMS");
            var valorERP = CalcularValorICMSERP(dadosERP, flagODA[ObterInt32(produto, "item")]);
            var igualValor = CompararValores(valorXML, valorERP);
            AdicionarComparacao(grupo, "Valor ICMS (vICMS)", valorXML.ToString("C"), valorERP?.ToString("C") ?? "-", igualValor, 10, y);
            y += 25;

            // FCP (Fundo de Combate à Pobreza) - se houver
            var baseFCPXML = ObterDecimal(produto, "baseCalculoFCP");
            var aliquotaFCPXML = ObterDecimal(produto, "aliquotaFCP");
            var valorFCPXML = ObterDecimal(produto, "valorFCP");
            
            if (baseFCPXML > 0 || aliquotaFCPXML > 0 || valorFCPXML > 0)
            {
                y += 10;
                var lblFCP = new Label
                {
                    Text = "FCP (Fundo de Combate à Pobreza):",
                    Location = new Point(10, y),
                    Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                    AutoSize = true
                };
                grupo.Controls.Add(lblFCP);
                y += 25;

                if (baseFCPXML > 0)
                {
                    AdicionarInfoICMS(grupo, "Base Cálculo FCP", baseFCPXML.ToString("C"), 10, y);
                    y += 25;
                }
                if (aliquotaFCPXML > 0)
                {
                    AdicionarInfoICMS(grupo, "Alíquota FCP", $"{aliquotaFCPXML:F4}%", 10, y);
                    y += 25;
                }
                if (valorFCPXML > 0)
                {
                    AdicionarInfoICMS(grupo, "Valor FCP", valorFCPXML.ToString("C"), 10, y);
                    y += 25;
                }
            }

            // ICMS ST (se aplicável)
            var cstICMS = ObterString(produto, "icmsCST") ?? "";
            var permiteST = cstICMS == "10" || cstICMS == "30" || cstICMS == "70";
            
            if (permiteST)
            {
                y += 10;
                var lblST = new Label
                {
                    Text = "ICMS ST (Substituição Tributária):",
                    Location = new Point(10, y),
                    Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                    AutoSize = true
                };
                grupo.Controls.Add(lblST);
                y += 25;

                // Modalidade de Base de Cálculo ST (modBCST)
                var modBCSTXML = ObterString(produto, "icmsModBCST") ?? "";
                if (!string.IsNullOrEmpty(modBCSTXML))
                {
                    AdicionarInfoICMS(grupo, "Modalidade BC ST", modBCSTXML, 10, y);
                    y += 25;
                }

                // Base de Cálculo ST (vBCST)
                var baseSTXML = ObterDecimal(produto, "baseCalculoICMSST");
                var baseSTERP = CalcularBaseCalculoICMSSTERP(dadosERP);
                var igualBaseST = CompararValores(baseSTXML, baseSTERP);
                AdicionarComparacao(grupo, "Base de Cálculo ST (vBCST)", baseSTXML.ToString("C"), baseSTERP?.ToString("C") ?? "-", igualBaseST, 10, y);
                y += 25;

                // Alíquota ST (pICMSST)
                var aliqSTXML = ObterDecimal(produto, "aliquotaICMSST");
                var aliqSTERP = BuscarCampoERP(dadosERP, "aliquota", "ALIQUOTA");
                var igualAliqST = CompararValores(aliqSTXML, aliqSTERP);
                AdicionarComparacao(grupo, "Alíquota ST (pICMSST)", $"{aliqSTXML:F4}%", aliqSTERP != null ? $"{ConverterParaDecimal(aliqSTERP)?.ToString("F4") ?? "0.0000"}%" : "-", igualAliqST, 10, y);
                y += 25;

                // Valor ICMS ST (vICMSST)
                var valorSTXML = ObterDecimal(produto, "valorICMSST");
                var valorSTERP = BuscarCampoERP(dadosERP, "imposto", "IMPOSTO");
                var igualValorST = CompararValores(valorSTXML, valorSTERP);
                AdicionarComparacao(grupo, "Valor ICMS ST (vICMSST)", valorSTXML.ToString("C"), valorSTERP != null ? (ConverterParaDecimal(valorSTERP)?.ToString("C") ?? "-") : "-", igualValorST, 10, y);
                y += 25;

                // FCP ST (se houver)
                var baseFCPSTXML = ObterDecimal(produto, "baseCalculoFCPST");
                var aliquotaFCPSTXML = ObterDecimal(produto, "aliquotaFCPST");
                var valorFCPSTXML = ObterDecimal(produto, "valorFCPST");
                
                if (baseFCPSTXML > 0 || aliquotaFCPSTXML > 0 || valorFCPSTXML > 0)
                {
                    y += 10;
                    var lblFCPST = new Label
                    {
                        Text = "FCP ST:",
                        Location = new Point(10, y),
                        Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                        AutoSize = true
                    };
                    grupo.Controls.Add(lblFCPST);
                    y += 25;

                    if (baseFCPSTXML > 0)
                    {
                        AdicionarInfoICMS(grupo, "Base Cálculo FCP ST", baseFCPSTXML.ToString("C"), 10, y);
                        y += 25;
                    }
                    if (aliquotaFCPSTXML > 0)
                    {
                        AdicionarInfoICMS(grupo, "Alíquota FCP ST", $"{aliquotaFCPSTXML:F4}%", 10, y);
                        y += 25;
                    }
                    if (valorFCPSTXML > 0)
                    {
                        AdicionarInfoICMS(grupo, "Valor FCP ST", valorFCPSTXML.ToString("C"), 10, y);
                        y += 25;
                    }
                }

                // ICMS60 - Campos de retenção (se houver)
                var baseSTRetXML = ObterDecimal(produto, "baseCalculoICMSSTRet");
                var aliquotaSTRetXML = ObterDecimal(produto, "aliquotaICMSSTRet");
                var valorICMSSubstitutoXML = ObterDecimal(produto, "valorICMSSubstituto");
                var valorICMSSTRetXML = ObterDecimal(produto, "valorICMSSTRet");
                
                if (baseSTRetXML > 0 || aliquotaSTRetXML > 0 || valorICMSSubstitutoXML > 0 || valorICMSSTRetXML > 0)
                {
                    y += 10;
                    var lblSTRet = new Label
                    {
                        Text = "ICMS Retido (ICMS60):",
                        Location = new Point(10, y),
                        Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                        AutoSize = true
                    };
                    grupo.Controls.Add(lblSTRet);
                    y += 25;

                    if (baseSTRetXML > 0)
                    {
                        AdicionarInfoICMS(grupo, "Base Cálculo ST Ret", baseSTRetXML.ToString("C"), 10, y);
                        y += 25;
                    }
                    if (aliquotaSTRetXML > 0)
                    {
                        AdicionarInfoICMS(grupo, "Alíquota ST Ret", $"{aliquotaSTRetXML:F4}%", 10, y);
                        y += 25;
                    }
                    if (valorICMSSubstitutoXML > 0)
                    {
                        AdicionarInfoICMS(grupo, "Valor ICMS Substituto", valorICMSSubstitutoXML.ToString("C"), 10, y);
                        y += 25;
                    }
                    if (valorICMSSTRetXML > 0)
                    {
                        AdicionarInfoICMS(grupo, "Valor ICMS ST Ret", valorICMSSTRetXML.ToString("C"), 10, y);
                        y += 25;
                    }
                }
            }
        }

        private void CriarComparacaoIPI(Dictionary<string, object> produto, Dictionary<string, object> dadosERP, GroupBox grupo)
        {
            int y = 20;

            // Base de Cálculo
            var baseXML = ObterDecimal(produto, "baseCalculoIPI");
            var baseERP = CalcularBaseCalculoIPIERP(dadosERP, flagODA[ObterInt32(produto, "item")]);
            var igualBase = CompararValores(baseXML, baseERP);
            AdicionarComparacao(grupo, "Base de Cálculo", baseXML.ToString("C"), baseERP?.ToString("C") ?? "-", igualBase, 10, y);
            y += 25;

            // Alíquota
            var aliqXML = ObterDecimal(produto, "aliquotaIPI");
            var aliqERP = BuscarCampoERP(dadosERP, "ipi", "IPI");
            var igualAliq = CompararValores(aliqXML, aliqERP);
            AdicionarComparacao(grupo, "Alíquota", $"{aliqXML:F2}%", aliqERP != null ? $"{ConverterParaDecimal(aliqERP)?.ToString("F2") ?? "0.00"}%" : "-", igualAliq, 10, y);
            y += 25;

            // Valor IPI
            var valorXML = ObterDecimal(produto, "valorIPI");
            var valorERP = CalcularValorIPIERP(dadosERP, flagODA[ObterInt32(produto, "item")]);
            var igualValor = CompararValores(valorXML, valorERP);
            AdicionarComparacao(grupo, "Valor IPI", valorXML.ToString("C"), valorERP?.ToString("C") ?? "-", igualValor, 10, y);
        }

        private void AdicionarComparacao(GroupBox grupo, string label, string valorXML, string valorERP, bool igual, int x, int y)
        {
            // Coluna 1: Label (largura fixa para alinhamento)
            var lbl = new Label
            {
                Text = $"{label}:",
                Location = new Point(x, y),
                Width = 200,
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(lbl);

            // Coluna 2: Valor XML (alinhado à direita para valores numéricos)
            var lblXML = new Label
            {
                Text = valorXML,
                Location = new Point(x + 210, y),
                Width = 180,
                Font = new Font("Segoe UI", 8.5F),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(lblXML);

            // Coluna 3: Valor ERP (alinhado à direita para valores numéricos)
            var lblERP = new Label
            {
                Text = valorERP,
                Location = new Point(x + 400, y),
                Width = 250,
                Font = new Font("Segoe UI", 8.5F),
                ForeColor = igual ? Color.Green : (valorERP == "-" ? Color.Gray : Color.Red),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(lblERP);

            // Indicador de erro (se houver divergência)
            if (valorERP != "-" && !igual)
            {
                var lblErro = new Label
                {
                    Text = "✗",
                    Location = new Point(x + 660, y),
                    ForeColor = Color.Red,
                    Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                    AutoSize = true,
                    TextAlign = ContentAlignment.MiddleCenter
                };
                grupo.Controls.Add(lblErro);
            }
        }

        private void AjustarPosicoesItens(Control container)
        {
            int y = 0;
            foreach (Control ctrl in container.Controls.OfType<Panel>().OrderBy(p => p.Location.Y))
            {
                ctrl.Location = new Point(ctrl.Location.X, y);
                y += ctrl.Height + 5;
            }
        }

        // Funções auxiliares de busca e cálculo
        // Versões para Dictionary
        private string ObterString(Dictionary<string, object> dict, string propertyName)
        {
            if (!dict.TryGetValue(propertyName, out var value) || value == null) return null;
            return value.ToString();
        }

        private decimal ObterDecimal(Dictionary<string, object> dict, string propertyName)
        {
            if (!dict.TryGetValue(propertyName, out var value) || value == null) return 0;
            if (value is decimal dec) return dec;
            if (value is int intVal) return intVal;
            if (value is double dbl) return (decimal)dbl;
            if (value is string str && decimal.TryParse(str, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var result))
                return result;
            return 0;
        }

        private int ObterInt32(Dictionary<string, object> dict, string propertyName)
        {
            if (!dict.TryGetValue(propertyName, out var value) || value == null) return 0;
            if (value is int intVal) return intVal;
            if (value is decimal dec) return (int)dec;
            if (value is double dbl) return (int)dbl;
            if (value is string str && int.TryParse(str, out var result))
                return result;
            return 0;
        }

        // Versões sobrecarregadas para JsonElement (para uso em ExibirDetalhes)
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
            if (prop.ValueKind == JsonValueKind.Number) return prop.GetDecimal();
            if (prop.ValueKind == JsonValueKind.String && decimal.TryParse(prop.GetString(), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var result))
                return result;
            return 0;
        }

        private int ObterInt32(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var prop)) return 0;
            if (prop.ValueKind == JsonValueKind.Null) return 0;
            if (prop.ValueKind == JsonValueKind.Number) return prop.GetInt32();
            if (prop.ValueKind == JsonValueKind.String && int.TryParse(prop.GetString(), out var result))
                return result;
            return 0;
        }

        // Métodos de conversão
        private Dictionary<string, object> ConverterJsonElementParaDict(JsonElement element)
        {
            var dict = new Dictionary<string, object>();
            foreach (var prop in element.EnumerateObject())
            {
                dict[prop.Name] = ConverterValorJson(prop.Value);
            }
            return dict;
        }

        private object ConverterValorJson(JsonElement value)
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.Object:
                    return ConverterJsonElementParaDict(value);
                case JsonValueKind.Array:
                    var list = new List<object>();
                    foreach (var item in value.EnumerateArray())
                    {
                        list.Add(ConverterValorJson(item));
                    }
                    return list;
                case JsonValueKind.String:
                    return value.GetString() ?? "";
                case JsonValueKind.Number:
                    if (value.TryGetInt32(out var intVal))
                        return intVal;
                    return value.GetDecimal();
                case JsonValueKind.True:
                    return true;
                case JsonValueKind.False:
                    return false;
                case JsonValueKind.Null:
                    return null;
                default:
                    return value.ToString();
            }
        }

        private JsonElement ConverterParaJsonElement(object obj)
        {
            if (obj is Dictionary<string, object> dict)
            {
                var json = JsonSerializer.Serialize(dict);
                return JsonDocument.Parse(json).RootElement;
            }
            var jsonStr = JsonSerializer.Serialize(obj);
            return JsonDocument.Parse(jsonStr).RootElement;
        }

        // Método auxiliar para converter valores para decimal usando ponto como separador (formato do banco)
        private decimal? ConverterParaDecimal(object valor)
        {
            if (valor == null) return null;
            
            if (valor is decimal dec) return dec;
            if (valor is int intVal) return intVal;
            if (valor is double dbl) return (decimal)dbl;
            if (valor is float flt) return (decimal)flt;
            
            // Para strings, usar InvariantCulture (ponto como separador decimal)
            if (valor is string str)
            {
                if (decimal.TryParse(str, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var result))
                    return result;
            }
            
            // Tentar converter usando InvariantCulture
            try
            {
                return Convert.ToDecimal(valor, System.Globalization.CultureInfo.InvariantCulture);
            }
            catch
            {
                return null;
            }
        }

        // Versão para Dictionary
        private object BuscarCampoERP(Dictionary<string, object> dadosERP, params string[] nomes)
        {
            if (dadosERP == null) return null;
            
            foreach (var nome in nomes)
            {
                if (dadosERP.TryGetValue(nome, out var value) && value != null)
                {
                    return value;
                }
                
                var nomeUpper = nome.ToUpper();
                if (dadosERP.TryGetValue(nomeUpper, out var valueUpper) && valueUpper != null)
                {
                    return valueUpper;
                }
            }
            return null;
        }

        // Versão sobrecarregada para JsonElement (para compatibilidade)
        private object BuscarCampoERP(JsonElement dadosERP, params string[] nomes)
        {
            if (dadosERP.ValueKind == JsonValueKind.Null) return null;
            
            foreach (var nome in nomes)
            {
                if (dadosERP.TryGetProperty(nome, out var prop) && prop.ValueKind != JsonValueKind.Null)
                {
                    if (prop.ValueKind == JsonValueKind.Number)
                        return prop.GetDecimal();
                    if (prop.ValueKind == JsonValueKind.String)
                    {
                        var str = prop.GetString();
                        // Tentar converter para decimal se for um número
                        if (decimal.TryParse(str, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var dec))
                            return dec;
                        return str;
                    }
                    return prop.ToString();
                }
                
                var nomeUpper = nome.ToUpper();
                if (dadosERP.TryGetProperty(nomeUpper, out var propUpper) && propUpper.ValueKind != JsonValueKind.Null)
                {
                    if (propUpper.ValueKind == JsonValueKind.Number)
                        return propUpper.GetDecimal();
                    if (propUpper.ValueKind == JsonValueKind.String)
                    {
                        var str = propUpper.GetString();
                        // Tentar converter para decimal se for um número
                        if (decimal.TryParse(str, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var dec))
                            return dec;
                        return str;
                    }
                    return propUpper.ToString();
                }
            }
            return null;
        }

        private bool CompararValores(object valorXML, object valorERP)
        {
            if (valorXML == null || valorERP == null) return false;
            
            // Converter ambos para decimal usando InvariantCulture (ponto como separador)
            var xmlDec = ConverterParaDecimal(valorXML);
            var erpDec = ConverterParaDecimal(valorERP);
            
            if (xmlDec.HasValue && erpDec.HasValue)
                return Math.Abs(xmlDec.Value - erpDec.Value) < 0.01m;
            
            return string.Equals(valorXML.ToString(), valorERP.ToString(), StringComparison.OrdinalIgnoreCase);
        }

        // Funções de cálculo ERP - Versões para Dictionary
        private decimal? CalcularQuantidadeTributavelERP(Dictionary<string, object> dadosERP)
        {
            var qtd = BuscarCampoERP(dadosERP, "qtd", "QTD");
            var fator = BuscarCampoERP(dadosERP, "fator", "FATOR");
            
            if (qtd == null || fator == null) return null;
            
            var qtdNum = ConverterParaDecimal(qtd);
            var fatorNum = ConverterParaDecimal(fator);
            
            if (!qtdNum.HasValue || !fatorNum.HasValue) return null;
            if (fatorNum.Value == 1)
                return qtdNum;
            
            return Math.Round(qtdNum.Value * fatorNum.Value, 2);
        }

        private decimal? CalcularValorUnitarioTributavelERP(Dictionary<string, object> dadosERP)
        {
            var valor = BuscarCampoERP(dadosERP, "valor", "VALOR");
            var fator = BuscarCampoERP(dadosERP, "fator", "FATOR");
            var desconto = BuscarCampoERP(dadosERP, "desconto", "DESCONTO");
            
            if (valor == null || fator == null) return null;
            
            var valorNum = ConverterParaDecimal(valor);
            var fatorNum = ConverterParaDecimal(fator);
            var descontoNum = desconto != null ? ConverterParaDecimal(desconto) : 0;
            
            if (!valorNum.HasValue || !fatorNum.HasValue) return null;
            if (fatorNum.Value == 0) return null;
            
            return Math.Round((valorNum.Value / fatorNum.Value) + (descontoNum ?? 0), 2);
        }

        private decimal? CalcularValorDescontoERP(Dictionary<string, object> dadosERP)
        {
            var qtd = BuscarCampoERP(dadosERP, "qtd", "QTD");
            var desconto = BuscarCampoERP(dadosERP, "desconto", "DESCONTO");
            
            if (qtd == null || desconto == null) return null;
            
            var qtdNum = ConverterParaDecimal(qtd);
            var descontoNum = ConverterParaDecimal(desconto);
            
            if (!qtdNum.HasValue || !descontoNum.HasValue) return null;
            
            return Math.Round(qtdNum.Value * descontoNum.Value, 2);
        }

        private decimal? CalcularValorOutrosERP(Dictionary<string, object> dadosERP)
        {
            var qtd = BuscarCampoERP(dadosERP, "qtd", "QTD");
            var oda = BuscarCampoERP(dadosERP, "ODA", "oda", "Oda");
            
            if (qtd == null || oda == null) return null;
            
            var qtdNum = ConverterParaDecimal(qtd);
            var odaNum = ConverterParaDecimal(oda);
            
            if (!qtdNum.HasValue || !odaNum.HasValue) return null;
            
            return qtdNum.Value * odaNum.Value;
        }

        private string CalcularCSTERP(Dictionary<string, object> dadosERP)
        {
            var tributo = BuscarCampoERP(dadosERP, "tributo", "TRIBUTO");
            if (tributo == null) return null;
            
            var tributoNum = ConverterParaDecimal(tributo);
            if (!tributoNum.HasValue) return null;
            
            return ((int)tributoNum.Value).ToString().PadLeft(2, '0');
        }

        private decimal? CalcularBaseCalculoICMSERP(Dictionary<string, object> dadosERP, bool somarODA)
        {
            var cst = CalcularCSTERP(dadosERP);
            if (cst == "30" || cst == "40" || cst == "60") return 0;
            
            var qtd = BuscarCampoERP(dadosERP, "qtd", "QTD");
            var valor = BuscarCampoERP(dadosERP, "valor", "VALOR");
            var reducao = BuscarCampoERP(dadosERP, "reducao", "REDUCAO");
            var oda = BuscarCampoERP(dadosERP, "ODA", "oda", "Oda");
            
            if (qtd == null || valor == null) return null;
            
            var qtdNum = ConverterParaDecimal(qtd);
            var valorNum = ConverterParaDecimal(valor);
            var reducaoNum = reducao != null ? ConverterParaDecimal(reducao) : 0;
            var odaNum = somarODA && oda != null ? ConverterParaDecimal(oda) : 0;
            
            if (!qtdNum.HasValue || !valorNum.HasValue) return null;
            
            if ((reducaoNum ?? 0) == 0)
                return (qtdNum.Value * valorNum.Value) + (odaNum ?? 0);
            
            return (qtdNum.Value * valorNum.Value * ((reducaoNum ?? 0) / 100)) + (odaNum ?? 0);
        }

        private decimal? CalcularValorICMSERP(Dictionary<string, object> dadosERP, bool somarODA)
        {
            var baseCalc = CalcularBaseCalculoICMSERP(dadosERP, somarODA);
            var aliquota = BuscarCampoERP(dadosERP, "aliquota", "ALIQUOTA");
            
            if (baseCalc == null || aliquota == null) return null;
            
            var aliquotaNum = ConverterParaDecimal(aliquota);
            if (!aliquotaNum.HasValue) return null;
            
            return baseCalc.Value * (aliquotaNum.Value / 100);
        }

        private decimal? CalcularBaseCalculoICMSSTERP(Dictionary<string, object> dadosERP)
        {
            var cst = CalcularCSTERP(dadosERP);
            if (cst == "40" || cst == "60") return 0;
            
            var qtd = BuscarCampoERP(dadosERP, "qtd", "QTD");
            var valor = BuscarCampoERP(dadosERP, "valor", "VALOR");
            var lucro = BuscarCampoERP(dadosERP, "lucro", "LUCRO");
            var pauta = BuscarCampoERP(dadosERP, "Pauta", "PAUTA", "pauta");
            
            var lucroNum = ConverterParaDecimal(lucro);
            if (lucroNum.HasValue && lucroNum.Value != 0 && qtd != null && valor != null)
            {
                var qtdNum = ConverterParaDecimal(qtd);
                var valorNum = ConverterParaDecimal(valor);
                if (qtdNum.HasValue && valorNum.HasValue)
                    return (qtdNum.Value * valorNum.Value) * (1 + (lucroNum.Value / 100));
            }
            
            var pautaNum = ConverterParaDecimal(pauta);
            if (pautaNum.HasValue && pautaNum.Value != 0 && qtd != null)
            {
                var qtdNum = ConverterParaDecimal(qtd);
                if (qtdNum.HasValue)
                    return qtdNum.Value * pautaNum.Value;
            }
            
            return null;
        }

        private decimal? CalcularBaseCalculoIPIERP(Dictionary<string, object> dadosERP, bool somarODA)
        {
            var qtd = BuscarCampoERP(dadosERP, "qtd", "QTD");
            var valor = BuscarCampoERP(dadosERP, "valor", "VALOR");
            var reducao = BuscarCampoERP(dadosERP, "reducao", "REDUCAO");
            var oda = BuscarCampoERP(dadosERP, "ODA", "oda", "Oda");
            
            if (qtd == null || valor == null) return null;
            
            var qtdNum = ConverterParaDecimal(qtd);
            var valorNum = ConverterParaDecimal(valor);
            var reducaoNum = reducao != null ? ConverterParaDecimal(reducao) : 0;
            var odaNum = somarODA && oda != null ? ConverterParaDecimal(oda) : 0;
            
            if (!qtdNum.HasValue || !valorNum.HasValue) return null;
            
            if ((reducaoNum ?? 0) == 0)
                return (qtdNum.Value * valorNum.Value) + (odaNum ?? 0);
            
            return (qtdNum.Value * valorNum.Value * ((reducaoNum ?? 0) / 100)) + (odaNum ?? 0);
        }

        private decimal? CalcularValorIPIERP(Dictionary<string, object> dadosERP, bool somarODA)
        {
            var baseCalc = CalcularBaseCalculoIPIERP(dadosERP, somarODA);
            var ipi = BuscarCampoERP(dadosERP, "ipi", "IPI");
            
            if (baseCalc == null || ipi == null) return null;
            
            var ipiNum = ConverterParaDecimal(ipi);
            if (!ipiNum.HasValue) return null;
            
            return baseCalc.Value * (ipiNum.Value / 100);
        }

        private bool ItemTemErro(Dictionary<string, object> produto, bool flagODAForcada = true)
        {
            if (!produto.TryGetValue("dadosERP", out var erpObj) || erpObj == null)
                return false;
            
            Dictionary<string, object> dadosERP = null;
            if (erpObj is Dictionary<string, object> erpDict)
                dadosERP = erpDict;
            else if (erpObj is JsonElement erpJson && erpJson.ValueKind != JsonValueKind.Null)
                dadosERP = ConverterJsonElementParaDict(erpJson);
            
            if (dadosERP == null) return false;

            // Código
            var codigoXML = ObterString(produto, "codigo") ?? "";
            var codigoERP = BuscarCampoERP(dadosERP, "reffor", "REFFOR");
            if (codigoERP != null && !CompararValores(codigoXML, codigoERP)) return true;

            // Valor Desconto
            var descontoXML = ObterDecimal(produto, "valorDesconto");
            var descontoERP = CalcularValorDescontoERP(dadosERP);
            if (descontoERP != null && !CompararValores(descontoXML, descontoERP)) return true;

            // Valor Outros
            var outrosXML = ObterDecimal(produto, "valorOutros");
            var outrosERP = CalcularValorOutrosERP(dadosERP);
            if (outrosERP != null && !CompararValores(outrosXML, outrosERP)) return true;

            // CST
            var cstXML = ObterString(produto, "icmsCST") ?? "";
            var cstERP = CalcularCSTERP(dadosERP);
            if (cstERP != null && !CompararValores(cstXML, cstERP)) return true;

            // Base de Cálculo ICMS
            var baseXML = ObterDecimal(produto, "baseCalculoICMS");
            var baseERP = CalcularBaseCalculoICMSERP(dadosERP, flagODAForcada);
            if (baseERP != null && !CompararValores(baseXML, baseERP)) return true;

            // Alíquota ICMS
            var aliqXML = ObterDecimal(produto, "aliquotaICMS");
            var aliqERP = BuscarCampoERP(dadosERP, "aliquota", "ALIQUOTA");
            if (aliqERP != null && !CompararValores(aliqXML, aliqERP)) return true;

            // Valor ICMS
            var valorICMSXML = ObterDecimal(produto, "valorICMS");
            var valorICMSERP = CalcularValorICMSERP(dadosERP, flagODAForcada);
            if (valorICMSERP != null && !CompararValores(valorICMSXML, valorICMSERP)) return true;

            // ICMS ST (se aplicável)
            var cstICMS = ObterString(produto, "icmsCST") ?? "";
            if (cstICMS == "10" || cstICMS == "30" || cstICMS == "70")
            {
                var baseSTXML = ObterDecimal(produto, "baseCalculoICMSST");
                var baseSTERP = CalcularBaseCalculoICMSSTERP(dadosERP);
                if (baseSTERP != null && !CompararValores(baseSTXML, baseSTERP)) return true;

                var valorSTXML = ObterDecimal(produto, "valorICMSST");
                var valorSTERP = BuscarCampoERP(dadosERP, "imposto", "IMPOSTO");
                if (valorSTERP != null && !CompararValores(valorSTXML, valorSTERP)) return true;
            }

            // IPI (se houver)
            if (ObterDecimal(produto, "valorIPI") > 0)
            {
                var baseIPIXML = ObterDecimal(produto, "baseCalculoIPI");
                var baseIPIERP = CalcularBaseCalculoIPIERP(dadosERP, flagODAForcada);
                if (baseIPIERP != null && !CompararValores(baseIPIXML, baseIPIERP)) return true;

                var aliqIPIXML = ObterDecimal(produto, "aliquotaIPI");
                var aliqIPIERP = BuscarCampoERP(dadosERP, "ipi", "IPI");
                if (aliqIPIERP != null && !CompararValores(aliqIPIXML, aliqIPIERP)) return true;

                var valorIPIXML = ObterDecimal(produto, "valorIPI");
                var valorIPIERP = CalcularValorIPIERP(dadosERP, flagODAForcada);
                if (valorIPIERP != null && !CompararValores(valorIPIXML, valorIPIERP)) return true;
            }

            return false;
        }

        private void AdicionarInfo(GroupBox grupo, string label, string valor, int x, int y)
        {
            var lbl = new Label
            {
                Text = $"{label}:",
                Location = new Point(x, y),
                AutoSize = true,
                Font = new Font("Segoe UI", 8F, FontStyle.Bold)
            };
            grupo.Controls.Add(lbl);

            var txt = new Label
            {
                Text = valor ?? "-",
                Location = new Point(x + 100, y),
                AutoSize = true,
                Font = new Font("Segoe UI", 8F)
            };
            grupo.Controls.Add(txt);
        }

        // Método auxiliar para adicionar informações do ICMS (apenas XML, sem comparação)
        private void AdicionarInfoICMS(GroupBox grupo, string label, string valor, int x, int y)
        {
            // Label (mesma largura das comparações para alinhamento)
            var lbl = new Label
            {
                Text = $"{label}:",
                Location = new Point(x, y),
                Width = 200,
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(lbl);

            // Valor (alinhado com a coluna XML)
            var txt = new Label
            {
                Text = valor ?? "-",
                Location = new Point(x + 210, y),
                Width = 180,
                Font = new Font("Segoe UI", 8.5F),
                TextAlign = ContentAlignment.MiddleLeft
            };
            grupo.Controls.Add(txt);
        }

        private void AdicionarTotal(GroupBox grupo, string label, decimal valor, int x, int y)
        {
            var lbl = new Label
            {
                Text = label,
                Location = new Point(x, y),
                AutoSize = true,
                Font = new Font("Segoe UI", 8F)
            };
            grupo.Controls.Add(lbl);

            var txt = new Label
            {
                Text = valor.ToString("C", new System.Globalization.CultureInfo("pt-BR")),
                Location = new Point(x, y + 20),
                AutoSize = true,
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                ForeColor = Color.FromArgb(200, 16, 46)
            };
            grupo.Controls.Add(txt);
        }

        // Métodos de ação (DANFE, XML, Copiar)
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

        private void CopiarChave(string chave)
        {
            try
            {
                Clipboard.SetText(chave);
                MessageBox.Show("Chave de acesso copiada para a área de transferência!", "Sucesso", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erro ao copiar chave: {ex.Message}", "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
