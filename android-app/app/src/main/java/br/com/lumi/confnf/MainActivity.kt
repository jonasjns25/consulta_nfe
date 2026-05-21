package br.com.lumi.confnf

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val db = Room.databaseBuilder(
            applicationContext,
            ConfNfDatabase::class.java,
            "confnf-cache.db"
        ).fallbackToDestructiveMigration().build()

        val repository = ConfNfRepository(db.cacheDao())
        val factory = ConfNfViewModelFactory(repository)

        setContent {
            MaterialTheme {
                val viewModel = androidx.lifecycle.viewmodel.compose.viewModel<ConfNfViewModel>(factory = factory)
                ConfNfApp(viewModel)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfNfApp(viewModel: ConfNfViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(uiState.message) {
        uiState.message?.let { snackbarHostState.showSnackbar(it) }
        if (uiState.message != null) viewModel.clearMessage()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("ConfNF MVP") },
                actions = {
                    if (uiState.user != null) {
                        TextButton(onClick = { viewModel.logout() }) {
                            Text("Sair")
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                ServerCard(
                    baseUrl = uiState.baseUrl,
                    onBaseUrlChange = viewModel::updateBaseUrl
                )
            }

            if (uiState.user == null) {
                item {
                    LoginCard(
                        usuario = uiState.loginUser,
                        senha = uiState.loginPassword,
                        pin = uiState.loginPin,
                        onUsuarioChange = viewModel::updateLoginUser,
                        onSenhaChange = viewModel::updateLoginPassword,
                        onPinChange = viewModel::updateLoginPin,
                        onEntrar = viewModel::login
                    )
                }
            } else {
                item {
                    SessionCard(uiState = uiState)
                }

                item {
                    SearchCard(
                        chave = uiState.chaveNfe,
                        codigoLeitura = uiState.codigoLeitura,
                        onChaveChange = viewModel::updateChave,
                        onCodigoLeituraChange = viewModel::updateCodigoLeitura,
                        onBuscar = viewModel::buscarNfe,
                        onIniciar = viewModel::iniciarConferencia,
                        onCarregarCache = viewModel::carregarCache,
                        onLocalizarItem = viewModel::localizarItemPorCodigo,
                        coletor = isColetorDeDados()
                    )
                }

                uiState.preview?.let { preview ->
                    item {
                        PreviewCard(preview)
                    }
                }

                uiState.nfe?.let { nfe ->
                    item {
                        HeaderCard(nfe, uiState.conferenceId)
                    }

                    uiState.items.firstOrNull { it.nItem == uiState.editingItemNItem }?.let { editingItem ->
                        item {
                            ItemEditorCard(
                                item = editingItem,
                                onQuantidadeChange = { value -> viewModel.updateQuantidade(editingItem.nItem, value) },
                                onAddLote = { viewModel.adicionarLote(editingItem.nItem) },
                                onUpdateLote = { index, field, value -> viewModel.updateLote(editingItem.nItem, index, field, value) },
                                onRemoveLote = { index -> viewModel.removerLote(editingItem.nItem, index) },
                                onFechar = viewModel::fecharEditorItem
                            )
                        }
                    }

                    items(uiState.items, key = { it.nItem }) { item ->
                        ItemCard(
                            item = item,
                            onEditar = { viewModel.abrirEditorItem(item.nItem) }
                        )
                    }

                    item {
                        ExtraCard(
                            extras = uiState.extras,
                            extraEan = uiState.extraEan,
                            extraDescricao = uiState.extraDescricao,
                            extraQuantidade = uiState.extraQuantidade,
                            onEanChange = viewModel::updateExtraEan,
                            onDescricaoChange = viewModel::updateExtraDescricao,
                            onQuantidadeChange = viewModel::updateExtraQuantidade,
                            onAdicionar = viewModel::adicionarExtra,
                            onRemover = viewModel::removerExtra
                        )
                    }

                    item {
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = uiState.observacao,
                            onValueChange = viewModel::updateObservacao,
                            label = { Text("Observacao geral") }
                        )
                    }

                    item {
                        Button(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = viewModel::enviarResultado,
                            enabled = uiState.conferenceId != null
                        ) {
                            Text("Enviar para aprovacao")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ServerCard(baseUrl: String, onBaseUrlChange: (String) -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Servidor ERP", fontWeight = FontWeight.Bold)
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = baseUrl,
                onValueChange = onBaseUrlChange,
                label = { Text("Base URL da API") }
            )
            Text("Ex.: http://10.0.2.2:3008/ ou URL interna do servidor.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun LoginCard(
    usuario: String,
    senha: String,
    pin: String,
    onUsuarioChange: (String) -> Unit,
    onSenhaChange: (String) -> Unit,
    onPinChange: (String) -> Unit,
    onEntrar: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Login", fontWeight = FontWeight.Bold)
            OutlinedTextField(value = usuario, onValueChange = onUsuarioChange, modifier = Modifier.fillMaxWidth(), label = { Text("Usuario") })
            OutlinedTextField(value = senha, onValueChange = onSenhaChange, modifier = Modifier.fillMaxWidth(), label = { Text("Senha") })
            OutlinedTextField(value = pin, onValueChange = onPinChange, modifier = Modifier.fillMaxWidth(), label = { Text("PIN (opcional)") })
            Button(onClick = onEntrar, modifier = Modifier.fillMaxWidth()) {
                Text("Entrar")
            }
        }
    }
}

@Composable
fun SessionCard(uiState: ConfNfUiState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Sessao ativa", fontWeight = FontWeight.Bold)
            Text("Usuario: ${uiState.user?.nome.orEmpty()} (${uiState.user?.perfil.orEmpty()})")
            Text("Modo scanner: ${if (isColetorDeDados()) "Coletor / teclado emulado" else "Smartphone / camera"}")
        }
    }
}

@Composable
fun SearchCard(
    chave: String,
    codigoLeitura: String,
    onChaveChange: (String) -> Unit,
    onCodigoLeituraChange: (String) -> Unit,
    onBuscar: () -> Unit,
    onIniciar: () -> Unit,
    onCarregarCache: () -> Unit,
    onLocalizarItem: () -> Unit,
    coletor: Boolean
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Selecionar NF-e", fontWeight = FontWeight.Bold)
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = chave,
                onValueChange = { onChaveChange(it.filter(Char::isDigit).take(44)) },
                label = { Text("Chave NF-e") }
            )
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = codigoLeitura,
                onValueChange = onCodigoLeituraChange,
                label = { Text("Código de barras do produto") }
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onBuscar, modifier = Modifier.weight(1f)) {
                    Text("Buscar XML")
                }
                OutlinedButton(onClick = onIniciar, modifier = Modifier.weight(1f)) {
                    Text("Iniciar")
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onCarregarCache, modifier = Modifier.weight(1f)) {
                    Text("Retomar cache")
                }
                OutlinedButton(onClick = onLocalizarItem, modifier = Modifier.weight(1f)) {
                    Text(if (coletor) "Abrir item lido" else "Localizar item")
                }
            }
        }
    }
}

@Composable
fun PreviewCard(preview: ChavePreviewDto) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Preview da chave", fontWeight = FontWeight.Bold)
            Text("UF: ${preview.uf} (${preview.ufCodigo})")
            Text("CNPJ emitente: ${preview.cnpjEmitente}")
            Text("Serie / Numero: ${preview.serie} / ${preview.numero}")
            Text("Ambiente: ${preview.ambiente}")
        }
    }
}

@Composable
fun HeaderCard(nfe: NfeCabecalhoDto, conferenceId: Int?) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Cabecalho da NF", fontWeight = FontWeight.Bold)
            Text("NF ${nfe.nNF} / Serie ${nfe.serie}")
            Text("Emitente: ${nfe.emitente?.nome.orEmpty()}")
            Text("Data emissao: ${nfe.dhEmi.orEmpty()}")
            Text("Volumes declarados: ${nfe.volumes ?: 0}")
            Text("Peso bruto: ${nfe.pesoB ?: 0}")
            Text("Itens: ${nfe.itens.size}")
            Text("Conferencia: ${conferenceId ?: "nao iniciada"}")
        }
    }
}

@Composable
fun ItemCard(item: ConferenceItemUi, onEditar: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("#${item.nItem} - ${item.xProd}", fontWeight = FontWeight.Bold)
            Text("Cod. fornecedor: ${item.cProd}")
            Text("EAN caixa: ${item.cEAN.ifBlank { "-" }}")
            Text("EAN unitario: ${item.cEANTrib.ifBlank { "-" }}")
            Text("XML: ${item.uCom.ifBlank { "UN" }} | Digitar em: ${item.unidErp}")
            Text("Produto ERP: ${item.erpDescricao.ifBlank { "Sem vínculo ERP encontrado" }}")
            Text("Conversao ERP: ${textoConversaoItem(item)}")
            Text("Qtd contada no ERP: ${item.qtConferida.ifBlank { "0,0000" }} ${item.unidErp}")
            Text(textoQuantidadeXmlEstimada(item))
            Text("Lotes informados: ${item.lotes.size}")
            OutlinedButton(onClick = onEditar, modifier = Modifier.fillMaxWidth()) {
                Text("Lançar / editar")
            }
            Text("Status: ${item.status}")
        }
    }
}

@Composable
fun ItemEditorCard(
    item: ConferenceItemUi,
    onQuantidadeChange: (String) -> Unit,
    onAddLote: () -> Unit,
    onUpdateLote: (Int, String, String) -> Unit,
    onRemoveLote: (Int) -> Unit,
    onFechar: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Lançamento do item #${item.nItem}", fontWeight = FontWeight.Bold)
            Text(item.xProd)
            Text("ERP: ${item.erpDescricao.ifBlank { "Sem vínculo ERP encontrado" }}")
            Text("Códigos de leitura: ${item.scanCodes.joinToString().ifBlank { "-" }}")
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = item.qtConferida,
                onValueChange = onQuantidadeChange,
                label = { Text("Quantidade total no ERP") }
            )
            Text(textoQuantidadeXmlEstimada(item))
            item.lotes.forEachIndexed { index, lote ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Lote ${index + 1}", fontWeight = FontWeight.SemiBold)
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = lote.lote,
                            onValueChange = { onUpdateLote(index, "lote", it) },
                            label = { Text("Lote") }
                        )
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = lote.dtValidade,
                            onValueChange = { onUpdateLote(index, "dt_validade", it) },
                            label = { Text("Validade (AAAA-MM-DD)") }
                        )
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = lote.qtInformada,
                            onValueChange = { onUpdateLote(index, "qt_informada", it) },
                            label = { Text("Quantidade do lote") }
                        )
                        TextButton(onClick = { onRemoveLote(index) }) {
                            Text("Remover lote")
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAddLote, modifier = Modifier.weight(1f)) {
                    Text("Adicionar lote")
                }
                Button(onClick = onFechar, modifier = Modifier.weight(1f)) {
                    Text("Fechar editor")
                }
            }
        }
    }
}

@Composable
fun ExtraCard(
    extras: List<ExtraUi>,
    extraEan: String,
    extraDescricao: String,
    extraQuantidade: String,
    onEanChange: (String) -> Unit,
    onDescricaoChange: (String) -> Unit,
    onQuantidadeChange: (String) -> Unit,
    onAdicionar: () -> Unit,
    onRemover: (Int) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Itens extras", fontWeight = FontWeight.Bold)
            OutlinedTextField(value = extraEan, onValueChange = onEanChange, modifier = Modifier.fillMaxWidth(), label = { Text("EAN extra") })
            OutlinedTextField(value = extraDescricao, onValueChange = onDescricaoChange, modifier = Modifier.fillMaxWidth(), label = { Text("Descricao") })
            OutlinedTextField(value = extraQuantidade, onValueChange = onQuantidadeChange, modifier = Modifier.fillMaxWidth(), label = { Text("Quantidade") })
            Button(onClick = onAdicionar, modifier = Modifier.fillMaxWidth()) {
                Text("Adicionar item extra")
            }
            extras.forEachIndexed { index, extra ->
                Card {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(extra.descricao, fontWeight = FontWeight.Bold)
                            Text("EAN: ${extra.cEAN} | Qtd: ${extra.qtConferida}")
                        }
                        TextButton(onClick = { onRemover(index) }) { Text("Remover") }
                    }
                }
            }
        }
    }
}

class ConfNfViewModel(private val repository: ConfNfRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(ConfNfUiState())
    val uiState: StateFlow<ConfNfUiState> = _uiState.asStateFlow()

    fun clearMessage() {
        _uiState.value = _uiState.value.copy(message = null)
    }

    fun updateBaseUrl(value: String) { _uiState.value = _uiState.value.copy(baseUrl = value) }
    fun updateLoginUser(value: String) { _uiState.value = _uiState.value.copy(loginUser = value) }
    fun updateLoginPassword(value: String) { _uiState.value = _uiState.value.copy(loginPassword = value) }
    fun updateLoginPin(value: String) { _uiState.value = _uiState.value.copy(loginPin = value.filter(Char::isDigit).take(4)) }
    fun updateChave(value: String) {
        _uiState.value = _uiState.value.copy(
            chaveNfe = value,
            preview = value.takeIf { it.length == 44 }?.let(::montarPreviewChave)
        )
    }
    fun updateCodigoLeitura(value: String) { _uiState.value = _uiState.value.copy(codigoLeitura = value.trim()) }
    fun updateExtraEan(value: String) { _uiState.value = _uiState.value.copy(extraEan = value.filter(Char::isDigit)) }
    fun updateExtraDescricao(value: String) { _uiState.value = _uiState.value.copy(extraDescricao = value) }
    fun updateExtraQuantidade(value: String) { _uiState.value = _uiState.value.copy(extraQuantidade = value) }
    fun updateObservacao(value: String) { _uiState.value = _uiState.value.copy(observacao = value) }

    fun updateQuantidade(nItem: Int, value: String) {
        val novaLista = _uiState.value.items.map {
            if (it.nItem == nItem) it.copy(qtConferida = value) else it
        }
        _uiState.value = _uiState.value.copy(items = novaLista)
    }

    fun abrirEditorItem(nItem: Int) {
        _uiState.value = _uiState.value.copy(editingItemNItem = nItem)
    }

    fun fecharEditorItem() {
        _uiState.value = _uiState.value.copy(editingItemNItem = null, codigoLeitura = "")
    }

    fun localizarItemPorCodigo() {
        val state = _uiState.value
        val codigo = normalizarCodigoLeitura(state.codigoLeitura)
        if (codigo.isBlank()) {
            _uiState.value = state.copy(message = "Informe ou bipa um código antes de localizar.")
            return
        }
        val item = state.items.firstOrNull { conferenceItem ->
            conferenceItem.scanCodes.any { normalizarCodigoLeitura(it) == codigo }
        }
        _uiState.value = if (item == null) {
            state.copy(message = "Nenhum item da NF foi encontrado para o código lido.")
        } else {
            state.copy(editingItemNItem = item.nItem, codigoLeitura = "", message = "Item ${item.nItem} aberto para lançamento.")
        }
    }

    fun adicionarLote(nItem: Int) {
        val novaLista = _uiState.value.items.map {
            if (it.nItem == nItem) it.copy(lotes = it.lotes + LoteUi()) else it
        }
        _uiState.value = _uiState.value.copy(items = novaLista, editingItemNItem = nItem)
    }

    fun removerLote(nItem: Int, index: Int) {
        val novaLista = _uiState.value.items.map {
            if (it.nItem == nItem) it.copy(lotes = it.lotes.filterIndexed { loteIndex, _ -> loteIndex != index }) else it
        }
        _uiState.value = _uiState.value.copy(items = novaLista)
    }

    fun updateLote(nItem: Int, index: Int, field: String, value: String) {
        val novaLista = _uiState.value.items.map { item ->
            if (item.nItem != nItem) return@map item
            val lotesAtualizados = item.lotes.mapIndexed { loteIndex, lote ->
                if (loteIndex != index) {
                    lote
                } else {
                    when (field) {
                        "lote" -> lote.copy(lote = value)
                        "dt_validade" -> lote.copy(dtValidade = value)
                        "qt_informada" -> lote.copy(qtInformada = value)
                        else -> lote
                    }
                }
            }
            item.copy(lotes = lotesAtualizados)
        }
        _uiState.value = _uiState.value.copy(items = novaLista, editingItemNItem = nItem)
    }

    fun adicionarExtra() {
        val state = _uiState.value
        val quantidade = state.extraQuantidade.toDoubleOrNull() ?: 0.0
        if (state.extraDescricao.isBlank()) {
            _uiState.value = state.copy(message = "Informe a descricao do item extra.")
            return
        }
        val extras = state.extras.toMutableList()
        extras += ExtraUi(state.extraEan, state.extraDescricao, quantidade)
        _uiState.value = state.copy(
            extras = extras,
            extraEan = "",
            extraDescricao = "",
            extraQuantidade = ""
        )
    }

    fun removerExtra(index: Int) {
        val extras = _uiState.value.extras.toMutableList()
        if (index in extras.indices) extras.removeAt(index)
        _uiState.value = _uiState.value.copy(extras = extras)
    }

    fun login() {
        val state = _uiState.value
        viewModelScope.launch {
            runCatching {
                repository.login(
                    baseUrl = state.baseUrl,
                    usuario = state.loginUser,
                    senha = state.loginPassword,
                    pin = state.loginPin
                )
            }.onSuccess { response ->
                _uiState.value = _uiState.value.copy(
                    token = response.token,
                    user = response.usuario,
                    message = "Login realizado com sucesso."
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(message = it.message ?: "Falha no login.")
            }
        }
    }

    fun buscarNfe() {
        val state = _uiState.value
        if (!validarDigitoVerificador(state.chaveNfe)) {
            _uiState.value = state.copy(message = "Chave NF-e invalida.")
            return
        }
        viewModelScope.launch {
            runCatching {
                repository.buscarNfe(state.baseUrl, state.token.orEmpty(), state.chaveNfe)
            }.onSuccess { response ->
                repository.salvarCache(response)
                _uiState.value = _uiState.value.copy(
                    preview = response.chavePreview,
                    nfe = response.nfe,
                    codigoLeitura = "",
                    editingItemNItem = null,
                    items = response.nfe.itens.map {
                        ConferenceItemUi(
                            nItem = it.nItem,
                            cProd = it.cProd,
                            cEAN = it.cEAN,
                            cEANTrib = it.cEANTrib,
                            xProd = it.xProd,
                            uCom = it.uCom,
                            unidErp = it.unidErp ?: it.uCom,
                            erpDescricao = it.erpDescricao.orEmpty(),
                            erpTipoConversao = it.erpTipoConversao ?: it.tipoConversao ?: "nenhum",
                            erpFatorConversao = it.erpFatorConversao ?: it.fatorAplicado ?: 1.0,
                            erpPesoMedioUn = it.erpPesoMedioUn,
                            erpEncontrado = it.erpEncontrado ?: false,
                            scanCodes = it.scanCodes ?: emptyList(),
                            lotes = it.lotes?.map { lote ->
                                LoteUi(
                                    lote = lote.lote.orEmpty(),
                                    dtValidade = lote.dtValidade.orEmpty(),
                                    qtInformada = lote.qtInformada?.toString().orEmpty()
                                )
                            } ?: emptyList(),
                            qtConferida = it.qtConferida?.toString().orEmpty(),
                            status = it.status ?: "pendente"
                        )
                    },
                    conferenceId = response.conferencia?.id,
                    message = "NF-e carregada."
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(message = it.message ?: "Falha ao buscar NF-e.")
            }
        }
    }

    fun iniciarConferencia() {
        val state = _uiState.value
        if (state.nfe == null) {
            _uiState.value = state.copy(message = "Busque a NF-e antes de iniciar.")
            return
        }
        viewModelScope.launch {
            runCatching {
                repository.iniciarConferencia(
                    baseUrl = state.baseUrl,
                    token = state.token.orEmpty(),
                    chaveNfe = state.nfe.chaveNfe,
                    doca = "Recebimento Android"
                )
            }.onSuccess {
                _uiState.value = _uiState.value.copy(
                    conferenceId = it.idConferencia,
                    message = if (it.retomada) "Conferencia retomada." else "Conferencia iniciada."
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(message = it.message ?: "Falha ao iniciar conferencia.")
            }
        }
    }

    fun carregarCache() {
        val chave = _uiState.value.chaveNfe
        if (chave.isBlank()) {
            _uiState.value = _uiState.value.copy(message = "Informe a chave para carregar o cache.")
            return
        }
        viewModelScope.launch {
            repository.carregarCache(chave)?.let { cache ->
                _uiState.value = _uiState.value.copy(
                    nfe = cache.first,
                    items = cache.second,
                    preview = montarPreviewChave(chave),
                    editingItemNItem = null,
                    message = "Cache local carregado."
                )
            } ?: run {
                _uiState.value = _uiState.value.copy(message = "Nenhum cache local encontrado.")
            }
        }
    }

    fun enviarResultado() {
        val state = _uiState.value
        val conferenceId = state.conferenceId
        if (conferenceId == null) {
            _uiState.value = state.copy(message = "Nenhuma conferencia iniciada.")
            return
        }
        viewModelScope.launch {
            runCatching {
                repository.enviarResultado(
                    baseUrl = state.baseUrl,
                    token = state.token.orEmpty(),
                    idConferencia = conferenceId,
                    itens = state.items.map {
                        ResultadoItemRequest(
                            nItem = it.nItem,
                            qtConferida = it.qtConferida.toDoubleOrNull() ?: 0.0,
                            lotes = it.lotes.map { lote ->
                                ResultadoLoteRequest(
                                    lote = lote.lote.takeIf { value -> value.isNotBlank() },
                                    dtValidade = lote.dtValidade.takeIf { value -> value.isNotBlank() },
                                    qtInformada = lote.qtInformada.toDoubleOrNull() ?: 0.0,
                                    unidade = it.unidErp.takeIf { value -> value.isNotBlank() },
                                    obs = null
                                )
                            }.filter { lote ->
                                lote.qtInformada > 0.0 || !lote.lote.isNullOrBlank() || !lote.dtValidade.isNullOrBlank()
                            }
                        )
                    },
                    extras = state.extras.map {
                        ExtraRequest(
                            cEAN = it.cEAN,
                            descricao = it.descricao,
                            qtConferida = it.qtConferida
                        )
                    },
                    observacao = state.observacao
                )
            }.onSuccess {
                _uiState.value = _uiState.value.copy(message = "Resultado enviado para aprovacao.")
            }.onFailure {
                _uiState.value = _uiState.value.copy(message = it.message ?: "Falha ao enviar resultado.")
            }
        }
    }

    fun logout() {
        _uiState.value = ConfNfUiState(baseUrl = _uiState.value.baseUrl)
    }
}

class ConfNfViewModelFactory(private val repository: ConfNfRepository) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ConfNfViewModel(repository) as T
    }
}

data class ConfNfUiState(
    val baseUrl: String = "http://10.0.2.2:3008/",
    val token: String? = null,
    val user: UsuarioDto? = null,
    val loginUser: String = "conferente",
    val loginPassword: String = "123456",
    val loginPin: String = "",
    val chaveNfe: String = "",
    val preview: ChavePreviewDto? = null,
    val nfe: NfeCabecalhoDto? = null,
    val conferenceId: Int? = null,
    val items: List<ConferenceItemUi> = emptyList(),
    val codigoLeitura: String = "",
    val editingItemNItem: Int? = null,
    val extras: List<ExtraUi> = emptyList(),
    val extraEan: String = "",
    val extraDescricao: String = "",
    val extraQuantidade: String = "",
    val observacao: String = "",
    val message: String? = null
)

data class ConferenceItemUi(
    val nItem: Int,
    val cProd: String,
    val cEAN: String,
    val cEANTrib: String,
    val xProd: String,
    val uCom: String,
    val unidErp: String,
    val erpDescricao: String,
    val erpTipoConversao: String,
    val erpFatorConversao: Double,
    val erpPesoMedioUn: Double?,
    val erpEncontrado: Boolean,
    val scanCodes: List<String> = emptyList(),
    val lotes: List<LoteUi> = emptyList(),
    val qtConferida: String,
    val status: String
)

data class LoteUi(
    val lote: String = "",
    val dtValidade: String = "",
    val qtInformada: String = ""
)

data class ExtraUi(
    val cEAN: String,
    val descricao: String,
    val qtConferida: Double
)

class ConfNfRepository(private val cacheDao: ConfNfCacheDao) {
    private fun createApi(baseUrl: String): ConfNfApiService {
        val client = OkHttpClient.Builder()
            .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
            .build()

        return Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ConfNfApiService::class.java)
    }

    suspend fun login(baseUrl: String, usuario: String, senha: String, pin: String): LoginResponse {
        val response = createApi(baseUrl).login(LoginRequest(usuario, senha.takeIf { it.isNotBlank() }, pin.takeIf { it.isNotBlank() }))
        if (!response.isSuccessful) throw IllegalStateException(response.errorBody()?.string() ?: "Falha no login.")
        return response.body() ?: throw IllegalStateException("Resposta vazia no login.")
    }

    suspend fun buscarNfe(baseUrl: String, token: String, chaveNfe: String): NfeResponse {
        val response = createApi(baseUrl).buscarNfe("Bearer $token", chaveNfe)
        if (!response.isSuccessful) throw IllegalStateException(response.errorBody()?.string() ?: "Falha ao buscar NF-e.")
        return response.body() ?: throw IllegalStateException("Resposta vazia ao buscar NF-e.")
    }

    suspend fun iniciarConferencia(baseUrl: String, token: String, chaveNfe: String, doca: String): IniciarConferenciaResponse {
        val response = createApi(baseUrl).iniciarConferencia("Bearer $token", IniciarConferenciaRequest(chaveNfe, doca))
        if (!response.isSuccessful) throw IllegalStateException(response.errorBody()?.string() ?: "Falha ao iniciar conferencia.")
        return response.body() ?: throw IllegalStateException("Resposta vazia ao iniciar conferencia.")
    }

    suspend fun enviarResultado(
        baseUrl: String,
        token: String,
        idConferencia: Int,
        itens: List<ResultadoItemRequest>,
        extras: List<ExtraRequest>,
        observacao: String
    ) {
        val response = createApi(baseUrl).enviarResultado(
            "Bearer $token",
            ResultadoRequest(idConferencia, itens, extras, observacao)
        )
        if (!response.isSuccessful) throw IllegalStateException(response.errorBody()?.string() ?: "Falha ao enviar resultado.")
    }

    suspend fun salvarCache(response: NfeResponse) {
        withContext(Dispatchers.IO) {
            val nfe = response.nfe
            cacheDao.upsertConference(
                CachedConferenceEntity(
                    chaveNfe = nfe.chaveNfe,
                    nNF = nfe.nNF,
                    serie = nfe.serie,
                    emitente = nfe.emitente?.nome.orEmpty(),
                    dataEmissao = nfe.dhEmi.orEmpty(),
                    conferenciaId = response.conferencia?.id
                )
            )
            cacheDao.clearItems(nfe.chaveNfe)
            cacheDao.upsertItems(
                nfe.itens.map {
                    CachedItemEntity(
                        chaveNfe = nfe.chaveNfe,
                        nItem = it.nItem,
                        cProd = it.cProd,
                        cEAN = it.cEAN,
                        cEANTrib = it.cEANTrib,
                        xProd = it.xProd,
                        uCom = it.uCom,
                        unidErp = it.unidErp ?: it.uCom,
                        erpDescricao = it.erpDescricao.orEmpty(),
                        erpTipoConversao = it.erpTipoConversao ?: it.tipoConversao ?: "nenhum",
                        erpFatorConversao = it.erpFatorConversao ?: it.fatorAplicado ?: 1.0,
                        erpPesoMedioUn = it.erpPesoMedioUn,
                        erpEncontrado = it.erpEncontrado ?: false,
                        qtConferida = it.qtConferida,
                        status = it.status ?: "pendente"
                    )
                }
            )
        }
    }

    suspend fun carregarCache(chave: String): Pair<NfeCabecalhoDto, List<ConferenceItemUi>>? = withContext(Dispatchers.IO) {
        val conf = cacheDao.getConference(chave) ?: return@withContext null
        val items = cacheDao.getItems(chave)
        Pair(
            NfeCabecalhoDto(
                chaveNfe = conf.chaveNfe,
                nNF = conf.nNF,
                serie = conf.serie,
                dhEmi = conf.dataEmissao,
                emitente = PessoaDto(nome = conf.emitente),
                destinatario = null,
                volumes = 0,
                pesoB = 0.0,
                valorNF = 0.0,
                tpNF = "0",
                cStat = "100",
                xMotivo = "",
                protocolo = "",
                itens = items.map {
                    NfeItemDto(
                        nItem = it.nItem,
                        cProd = it.cProd,
                        cEAN = it.cEAN,
                        cEANTrib = it.cEANTrib,
                        xProd = it.xProd,
                        uCom = it.uCom,
                        unidErp = it.unidErp,
                        erpDescricao = it.erpDescricao,
                        erpTipoConversao = it.erpTipoConversao,
                        erpFatorConversao = it.erpFatorConversao,
                        erpPesoMedioUn = it.erpPesoMedioUn,
                        erpEncontrado = it.erpEncontrado,
                        scanCodes = emptyList(),
                        lotes = emptyList(),
                        fatorAplicado = 1.0,
                        tipoConversao = it.erpTipoConversao,
                        qtConferida = it.qtConferida,
                        status = it.status
                    )
                }
            ),
            items.map {
                ConferenceItemUi(
                    nItem = it.nItem,
                    cProd = it.cProd,
                    cEAN = it.cEAN,
                    cEANTrib = it.cEANTrib,
                    xProd = it.xProd,
                    uCom = it.uCom,
                    unidErp = it.unidErp,
                    erpDescricao = it.erpDescricao,
                    erpTipoConversao = it.erpTipoConversao,
                    erpFatorConversao = it.erpFatorConversao,
                    erpPesoMedioUn = it.erpPesoMedioUn,
                    erpEncontrado = it.erpEncontrado,
                    scanCodes = emptyList(),
                    lotes = emptyList(),
                    qtConferida = it.qtConferida?.toString().orEmpty(),
                    status = it.status
                )
            }
        )
    }
}

interface ConfNfApiService {
    @POST("api/confnf/login")
    suspend fun login(@Body body: LoginRequest): retrofit2.Response<LoginResponse>

    @GET("api/confnf/nfe/xml")
    suspend fun buscarNfe(
        @Header("Authorization") authorization: String,
        @Query("chave") chave: String
    ): retrofit2.Response<NfeResponse>

    @POST("api/confnf/conferencia/iniciar")
    suspend fun iniciarConferencia(
        @Header("Authorization") authorization: String,
        @Body body: IniciarConferenciaRequest
    ): retrofit2.Response<IniciarConferenciaResponse>

    @POST("api/confnf/conferencia/resultado")
    suspend fun enviarResultado(
        @Header("Authorization") authorization: String,
        @Body body: ResultadoRequest
    ): retrofit2.Response<Unit>
}

data class LoginRequest(val usuario: String, val senha: String?, val pin: String?)
data class LoginResponse(val token: String, val usuario: UsuarioDto)
data class UsuarioDto(val id: Int, val usuario: String, val nome: String, val perfil: String)

data class NfeResponse(
    @SerializedName("chave_preview") val chavePreview: ChavePreviewDto,
    val nfe: NfeCabecalhoDto,
    val conferencia: ConferenciaResumoDto?
)

data class ChavePreviewDto(
    val ufCodigo: String,
    val uf: String,
    val ano: String,
    val mes: String,
    val cnpjEmitente: String,
    val modelo: String,
    val serie: String,
    val numero: String,
    val ambiente: String
)

data class PessoaDto(
    val cnpj: String = "",
    val nome: String = ""
)

data class NfeCabecalhoDto(
    @SerializedName("chave_nfe") val chaveNfe: String,
    val nNF: String,
    val serie: String,
    val dhEmi: String,
    val emitente: PessoaDto?,
    val destinatario: PessoaDto?,
    val volumes: Int?,
    val pesoB: Double?,
    val valorNF: Double?,
    val tpNF: String?,
    val cStat: String?,
    val xMotivo: String?,
    val protocolo: String?,
    val itens: List<NfeItemDto>
)

data class NfeItemDto(
    val nItem: Int,
    val cProd: String,
    val cEAN: String,
    val cEANTrib: String,
    val xProd: String,
    val uCom: String,
    @SerializedName("unid_erp") val unidErp: String?,
    @SerializedName("erp_descricao") val erpDescricao: String?,
    @SerializedName("erp_tipo_conversao") val erpTipoConversao: String?,
    @SerializedName("erp_fator_conversao") val erpFatorConversao: Double?,
    @SerializedName("erp_peso_medio_un") val erpPesoMedioUn: Double?,
    @SerializedName("erp_encontrado") val erpEncontrado: Boolean?,
    @SerializedName("scan_codes") val scanCodes: List<String>?,
    val lotes: List<LoteDto>?,
    @SerializedName("fator_aplicado") val fatorAplicado: Double?,
    @SerializedName("tipo_conversao") val tipoConversao: String?,
    @SerializedName("qt_conferida") val qtConferida: Double?,
    val status: String?
)

data class LoteDto(
    val lote: String?,
    @SerializedName("dt_validade") val dtValidade: String?,
    @SerializedName("qt_informada") val qtInformada: Double?
)

data class ConferenciaResumoDto(val id: Int, val status: String)
data class IniciarConferenciaRequest(@SerializedName("chave_nfe") val chaveNfe: String, val doca: String)
data class IniciarConferenciaResponse(@SerializedName("id_conferencia") val idConferencia: Int, val status: String, val retomada: Boolean = false)
data class ResultadoItemRequest(
    @SerializedName("nItem") val nItem: Int,
    @SerializedName("qt_conferida") val qtConferida: Double,
    val lotes: List<ResultadoLoteRequest> = emptyList()
)
data class ResultadoLoteRequest(
    val lote: String?,
    @SerializedName("dt_validade") val dtValidade: String?,
    @SerializedName("qt_informada") val qtInformada: Double,
    val unidade: String?,
    val obs: String?
)
data class ExtraRequest(val cEAN: String, val descricao: String, @SerializedName("qt_conferida") val qtConferida: Double)
data class ResultadoRequest(
    @SerializedName("id_conferencia") val idConferencia: Int,
    val itens: List<ResultadoItemRequest>,
    val extras: List<ExtraRequest>,
    val obs: String
)

@Entity(tableName = "cached_conference")
data class CachedConferenceEntity(
    @PrimaryKey val chaveNfe: String,
    val nNF: String,
    val serie: String,
    val emitente: String,
    val dataEmissao: String,
    val conferenciaId: Int?
)

@Entity(tableName = "cached_item", primaryKeys = ["chaveNfe", "nItem"])
data class CachedItemEntity(
    val chaveNfe: String,
    val nItem: Int,
    val cProd: String,
    val cEAN: String,
    val cEANTrib: String,
    val xProd: String,
    val uCom: String,
    val unidErp: String,
    val erpDescricao: String,
    val erpTipoConversao: String,
    val erpFatorConversao: Double,
    val erpPesoMedioUn: Double?,
    val erpEncontrado: Boolean,
    val qtConferida: Double?,
    val status: String
)

@Dao
interface ConfNfCacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertConference(conference: CachedConferenceEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertItems(items: List<CachedItemEntity>)

    @Query("DELETE FROM cached_item WHERE chaveNfe = :chave")
    suspend fun clearItems(chave: String)

    @Query("SELECT * FROM cached_conference WHERE chaveNfe = :chave LIMIT 1")
    suspend fun getConference(chave: String): CachedConferenceEntity?

    @Query("SELECT * FROM cached_item WHERE chaveNfe = :chave ORDER BY nItem")
    suspend fun getItems(chave: String): List<CachedItemEntity>
}

@Database(
    entities = [CachedConferenceEntity::class, CachedItemEntity::class],
    version = 2,
    exportSchema = false
)
abstract class ConfNfDatabase : RoomDatabase() {
    abstract fun cacheDao(): ConfNfCacheDao
}

private fun textoConversaoItem(item: ConferenceItemUi): String {
    return when (item.erpTipoConversao.lowercase(Locale.getDefault())) {
        "peso" -> {
            val peso = item.erpPesoMedioUn ?: return "Conversao por peso sem peso medio configurado."
            if (peso <= 0.0) {
                "Conversao por peso sem peso medio configurado."
            } else {
                val porXml = 1.0 / peso
                "1 ${item.unidErp} ~ ${formatarNumeroLocal(peso)} ${item.uCom} | 1 ${item.uCom} ~ ${formatarNumeroLocal(porXml)} ${item.unidErp}"
            }
        }
        "fixo" -> "1 ${item.uCom} = ${formatarNumeroLocal(item.erpFatorConversao)} ${item.unidErp}"
        else -> "Sem conversao"
    }
}

private fun textoQuantidadeXmlEstimada(item: ConferenceItemUi): String {
    val quantidade = item.qtConferida.toDoubleOrNull()
        ?: return "Informe a quantidade contada no ERP para validar com o XML."
    val mesmaUnidade = item.uCom.equals(item.unidErp, ignoreCase = true)
    val estimada = when {
        mesmaUnidade || item.erpTipoConversao.equals("nenhum", ignoreCase = true) -> quantidade
        item.erpTipoConversao.equals("peso", ignoreCase = true) -> {
            val peso = item.erpPesoMedioUn ?: return "Peso medio nao configurado para este item."
            if (peso <= 0.0) return "Peso medio nao configurado para este item."
            quantidade * peso
        }
        item.erpTipoConversao.equals("fixo", ignoreCase = true) && item.erpFatorConversao > 0.0 -> quantidade / item.erpFatorConversao
        else -> quantidade
    }
    return "Equivalente no XML: ${formatarNumeroLocal(estimada)} ${item.uCom}"
}

private fun formatarNumeroLocal(value: Double): String {
    return String.format(Locale("pt", "BR"), "%.4f", value)
}

private fun normalizarCodigoLeitura(value: String): String {
    return value.trim().replace(" ", "").trimStart('0')
}

private fun montarPreviewChave(chave: String): ChavePreviewDto? {
    if (!Regex("^\\d{44}$").matches(chave)) return null
    val mapaUF = mapOf(
        "11" to "RO", "12" to "AC", "13" to "AM", "14" to "RR", "15" to "PA", "16" to "AP", "17" to "TO",
        "21" to "MA", "22" to "PI", "23" to "CE", "24" to "RN", "25" to "PB", "26" to "PE", "27" to "AL",
        "28" to "SE", "29" to "BA", "31" to "MG", "32" to "ES", "33" to "RJ", "35" to "SP", "41" to "PR",
        "42" to "SC", "43" to "RS", "50" to "MS", "51" to "MT", "52" to "GO", "53" to "DF"
    )
    return ChavePreviewDto(
        ufCodigo = chave.substring(0, 2),
        uf = mapaUF[chave.substring(0, 2)] ?: chave.substring(0, 2),
        ano = "20${chave.substring(2, 4)}",
        mes = chave.substring(4, 6),
        cnpjEmitente = chave.substring(6, 20),
        modelo = chave.substring(20, 22),
        serie = chave.substring(22, 25).toIntOrNull()?.toString().orEmpty(),
        numero = chave.substring(25, 34).toIntOrNull()?.toString().orEmpty(),
        ambiente = if (chave.substring(34, 35) == "1") "Producao" else "Homologacao"
    )
}

private fun validarDigitoVerificador(chave: String): Boolean {
    if (!Regex("^\\d{44}$").matches(chave)) return false
    val numeros = chave.dropLast(1)
    val dvInformado = chave.last().digitToInt()
    var soma = 0
    var peso = 2
    for (i in numeros.indices.reversed()) {
        soma += numeros[i].digitToInt() * peso
        peso = if (peso == 9) 2 else peso + 1
    }
    val resto = soma % 11
    val dvCalculado = if (resto < 2) 0 else 11 - resto
    return dvCalculado == dvInformado
}

fun isColetorDeDados(): Boolean {
    val fabricantes = listOf("ZEBRA", "HONEYWELL", "DATALOGIC", "UROVO", "NEWLAND")
    return fabricantes.contains(Build.MANUFACTURER.uppercase(Locale.getDefault()))
}
