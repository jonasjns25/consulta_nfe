'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    situacaoDominioDeCstat,
    montarStatusDeRetConsSitNFe,
    temEventoCancelamento,
} = require('../lib/sefaz-situacao-protocolo');
const { urlConsultaProtocoloNFe, cUfDaChave } = require('../lib/sefaz-nfe-consulta-protocolo-urls');
const { criarLimitador, MAX_POR_CHAVE } = require('../lib/sefaz-consulta-limiter');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('situacaoDominioDeCstat', () => {
    it('cStat 100 -> autorizada', () => {
        const r = situacaoDominioDeCstat('100', '100', []);
        assert.equal(r.situacao, 'autorizada');
    });
    it('cStat 101 -> cancelada', () => {
        assert.equal(situacaoDominioDeCstat('101', '', []).situacao, 'cancelada');
    });
    it('evento 110111 -> cancelada', () => {
        assert.equal(situacaoDominioDeCstat('100', '100', [{ tpEvento: '110111' }]).situacao, 'cancelada');
    });
    it('cStat 110 -> denegada', () => {
        assert.equal(situacaoDominioDeCstat('110', '', []).situacao, 'denegada');
    });
    it('cStat 217 -> nao_encontrada', () => {
        assert.equal(situacaoDominioDeCstat('217', '', []).situacao, 'nao_encontrada');
    });
    it('cStat 226 -> erro_roteamento', () => {
        assert.equal(situacaoDominioDeCstat('226', '', []).situacao, 'erro_roteamento');
    });
    it('cStat 656 -> consumo_indevido', () => {
        assert.equal(situacaoDominioDeCstat('656', '', []).situacao, 'consumo_indevido');
    });
});

describe('montarStatusDeRetConsSitNFe', () => {
    it('preenche nProt e dhRecbto', () => {
        const status = montarStatusDeRetConsSitNFe(
            { cStat: '100' },
            { cStat: '100', nProt: '123', dhRecbto: '2026-01-01T10:00:00-03:00' },
            { eventos: [], ambiente: 'Produção', temCce: false },
            '35260849275829000439550040000026561612376078',
            '12345678000199'
        );
        assert.equal(status.nProt, '123');
        assert.equal(status.situacao, 'autorizada');
    });
});

describe('urlConsultaProtocoloNFe', () => {
    it('UF 42 (SC) usa SVRS', () => {
        const chave = '42250812345678000199550010000000011000000001';
        assert.equal(cUfDaChave(chave), '42');
        assert.match(urlConsultaProtocoloNFe(chave, '1'), /svrs\.rs\.gov\.br/i);
    });
});

describe('limitador consulta protocolo', () => {
    it('bloqueia apos MAX_POR_CHAVE', () => {
        const tmp = path.join(os.tmpdir(), `sefaz-limiter-test-${Date.now()}.json`);
        const lim = criarLimitador({ filePath: tmp });
        const chave = '35260849275829000439550040000026561612376078';
        for (let i = 0; i < MAX_POR_CHAVE; i++) {
            lim.registrarConsultaRealizada(chave);
        }
        const bloqueado = lim.podeConsultar(chave, '12345678000199');
        assert.equal(bloqueado.permitido, false);
        fs.unlinkSync(tmp);
    });
    it('bloqueio 656', () => {
        const tmp = path.join(os.tmpdir(), `sefaz-limiter-656-${Date.now()}.json`);
        const lim = criarLimitador({ filePath: tmp });
        const chave = '35260849275829000439550040000026561612376078';
        lim.registrarBloqueio656(chave, '12345678000199');
        assert.equal(lim.podeConsultar(chave, '12345678000199').motivo, 'bloqueio_656');
        fs.unlinkSync(tmp);
    });
});
