# Estrutura da aba — Estatísticas CAGED

Documento de orientação para recriar **apenas** a aba Estatísticas CAGED em outro projeto.

| Item | Valor |
|------|--------|
| Aba / menu | `data-tab="dashboard-estatisticas"` |
| Painel DOM | `#tab-dashboard-estatisticas` |
| Template | `app/templates/index.html` (bloco da aba) |
| Backend | `app/servidor_caged.py` |
| Lógica | `scripts/dashboard_estatisticas_caged.py` |
| Apoio | `scripts/estoque_ceara.py`, `scripts/ce_regioes.py`, cache em `dashboard_turnover.carregar_caged` |
| CSV padrão | `caged_2026_geral.csv` (UF Ceará) |
| Estoque base | **1.374.628** (CE 12/2025), encadeado com saldo mensal **MOV + FOR − EXC** |
| Front | Chart.js + plugin datalabels |

---

## 1. Propósito

Painel de indicadores do mercado formal a partir do CAGED:

- Flutuação (admissões × desligamentos)
- Variação absoluta / relativa
- Índice de emprego encadeado (desde 12/2025)
- Taxa de rotatividade (TR)
- Salário médio de admissão (média aparada)
- Permanência no emprego (desligados)
- Perfil demográfico (sexo, faixa etária)
- Rankings: CBO, município, região, seção CNAE, agregação setorial, escolaridade, raça/cor

---

## 2. Layout da aba (ordem visual)

```
#tab-dashboard-estatisticas
├── section.panel
│   ├── h2 + hint (fórmulas / fonte)
│   ├── upload CSV + botão Atualizar
│   ├── #filtrosEstatsBox (accordion de filtros)
│   ├── #progressEstats (barra de progresso)
│   └── #dashEstatsStatus
├── #dashEstatsKpis          (.kpi-grid)
└── .charts-grid             (todos os gráficos)
```

---

## 3. Elementos de UI (IDs)

### 3.1 Arquivo e status

| ID | Tipo | Função |
|----|------|--------|
| `#fileDashEstats` | `input[type=file]` | Upload CSV/TXT |
| `#metaDashEstats` | `p.meta-line` | Nome do arquivo ativo |
| `#btnDashEstatsReload` | `button.secondary` | Recarregar resumo com filtros |
| `#dashEstatsStatus` | `p` | Mensagem ok/erro |
| `#dashEstatsKpis` | `div.kpi-grid` | KPIs do período |

### 3.2 Filtros (accordion)

| ID | Tipo | Função |
|----|------|--------|
| `#filtrosEstatsBox` | container | Classe `is-collapsed` quando fechado |
| `#filtrosEstatsHead` | head clicável | Expande/recolhe |
| `#btnEstatsToggleFiltros` | botão | “Expandir filtros” / “Recolher” |
| `#filtrosEstatsBody` | body | `hidden` quando recolhido |
| `#filtroEstatsAno` | `select[multiple]` | Anos |
| `#filtroEstatsMes` | `select[multiple]` | Competências (AAAAMM) |
| `#filtroEstatsGrup` | `select[multiple]` | Grande grupamento (agregação setorial) |
| `#filtroEstatsRegiao` | `select[multiple]` | Região administrativa |
| `#filtroEstatsMunBusca` | `input[search]` | Filtra lista de municípios |
| `#filtroEstatsMun` | `select[multiple]` | Municípios |
| `.btn-limpar-filtro[data-limpar]` | botão | `ano` \| `mes` \| `grup` \| `regiao` \| `mun` |
| `#btnEstatsLimparFiltros` | botão | Limpa todos |
| `#metaEstatsFiltros` | texto | Resumo dos filtros (corpo) |
| `#metaEstatsFiltrosHead` | texto | Resumo no cabeçalho do accordion |

### 3.3 Progresso (simulado no front)

| ID | Função |
|----|--------|
| `#progressEstats` | Box (classe `.show` quando ativo) |
| `#progressEstatsTitle` | Título |
| `#progressEstatsPct` | Percentual |
| `#progressEstatsFill` | Barra |
| `#progressEstatsEtapa` | Etapa textual |

Helpers JS: `startEstatsProgress`, `finishEstatsProgress`, `progEstats`.

### 3.4 Controles internos dos gráficos

| ID | Controle | Modos / valores |
|----|----------|-----------------|
| `#segEstatsSalario` | segmentador | `geral` \| `agregacao` |
| `#titleEstatsSalario` | título dinâmico | — |
| `#segEstatsCbo` | segmentador | `contratacoes` \| `desligamentos` \| `saldo` |
| `#titleEstatsCbo` | título dinâmico | — |
| `#selEstatsMun` | select | `admissoes` \| `demissoes` \| `saldo` \| `estoque` |
| `#titleEstatsMunSaldo` | título dinâmico | — |
| `#selEstatsRegiao` | select | idem município |
| `#titleEstatsRegiao` | título dinâmico | — |
| `#segEstatsSecao` | segmentador | `contratacoes` \| `desligamentos` \| `saldo` |
| `#segEstatsAgreg` | segmentador | idem |
| `#segEstatsEsc` | segmentador | idem |
| `#segEstatsRaca` | segmentador | idem |

**Regra:** com filtro de grande grupamento ativo, a opção `estoque` em município/região fica **desabilitada** (`estoque_disponivel: false`).

---

## 4. APIs

### 4.1 Upload

```
POST /api/dashboard/upload
FormData:
  tipo = "estatisticas"
  file = <csv>
```

Resposta típica: confirma arquivo ativo em `DASH_FILES["estatisticas"]`.

### 4.2 Opções de filtro

```
GET /api/dashboard/estatisticas-caged/opcoes
?arquivo=   (opcional)
```

**Resposta:**

```json
{
  "anos": ["2026"],
  "meses": [{ "valor": "202601", "label": "jan/2026" }],
  "regioes": [{ "valor": "...", "label": "..." }],
  "municipios": [{ "valor": "2304400", "label": "Fortaleza" }],
  "grupamentos": [{ "valor": "Indústria", "label": "Indústria" }],
  "fonte_regioes": "...",
  "arquivo": "...",
  "arquivo_nome": "caged_2026_geral.csv"
}
```

### 4.3 Resumo (payload principal)

```
GET /api/dashboard/estatisticas-caged
?anos=2026
&competencias=202601,202602   (alias: meses)
&regioes=...
&municipios=...
&grupamentos=...              (alias: agregacoes)
&arquivo=                     (opcional)
```

Listas enviadas como string CSV no query string.

---

## 5. Contrato de dados do resumo

### 5.1 Metadados e KPIs (`periodo`)

| Campo | Significado |
|-------|-------------|
| `arquivo` / `arquivo_nome` / `arquivo_ativo` | Fonte |
| `unidade` | Ex.: “Ceará”, município, região |
| `total_linhas` | Linhas após filtro |
| `filtros` | Meta do que foi aplicado |
| `periodo.admissoes` | Soma A no período |
| `periodo.desligamentos` | Soma D |
| `periodo.variacao_absoluta` | A − D |
| `periodo.variacao_relativa` | (A−D)/E(1º dia)×100 |
| `periodo.taxa_rotatividade` | min(A,D)/E(1º dia)×100 |
| `periodo.estoque_inicio` / `estoque_fim` | Encadeados |
| `periodo.indice_emprego_encadeado` | Índice base 100 (UI exibe **índice − 100** em %) |
| `periodo.indice_emprego_periodo` | Variação do período em índice |
| `periodo.n_meses` / `periodo.label` | Rótulo do recorte |
| `estoque_base.valor` | Base 12/2025 (estado ou soma municipal) |
| `estoque_base.aplicavel` | Se indicadores de estoque estão disponíveis |
| `estoque_base.aviso` | Ex.: filtro setorial sem estoque |
| `formulas` | Textos das fórmulas |
| `referencia_estado` | Série do estado (para linhas de referência nos gráficos %) |
| `serie` | Lista mensal bruta (admissões, desligamentos, estoques, etc.) |
| `ultimo` | Último mês da série |

### 5.2 Séries para gráficos (formato comum `{label, valor}`)

| Campo API | Uso no gráfico |
|-----------|----------------|
| `flutuacao_admissoes` | Linha admissões |
| `flutuacao_desligamentos` | Linha desligamentos |
| `variacao_absoluta_mes` | Saldo A−D mensal |
| `variacao_relativa_mes` | % mensal |
| `indice_emprego_encadeado` | % acumulada (já como índice−100 no payload de exibição) |
| `taxa_rotatividade_mes` | TR % mensal |
| `admissoes_por_tipo` | Barras horizontais |
| `desligamentos_por_tipo` | Barras horizontais |
| `desligamentos_top4_mensal` | `{ labels, series:[{label, valores}] }` |
| `tipos_ultimo_mes` | Detalhe do último mês (apoio) |

### 5.3 `salario_medio`

```json
{
  "labels": ["jan/2026", "..."],
  "series": [
    { "label": "Salário médio geral", "valores": [n, ...] },
    { "label": "Salário médio homem", "valores": [n, ...] },
    { "label": "Salário médio mulher", "valores": [n, ...] }
  ],
  "agregacao": {
    "labels": ["..."],
    "series": [{ "label": "Indústria", "valores": [n, ...] }]
  },
  "metodo": "média aparada 5% ..."
}
```

Modo UI `geral` → `series`; modo `agregacao` → `agregacao.series`.  
Pode cruzar com `referencia_estado.salario_medio` quando o recorte não é o estado inteiro.

### 5.4 `permanencia`

```json
{
  "faixas_desligados": [{ "label": "Até 3 meses", "valor": 123 }],
  "serie_mensal": {
    "labels": ["jan/2026"],
    "series": [
      { "label": "Mediana (meses)", "valores": [n] },
      { "label": "Média aparada (meses)", "valores": [n] }
    ]
  },
  "unidade": "meses"
}
```

Faixas fixas: Até 3 meses · 3–6 · 6–12 · 1–2 anos · 2–5 · 5–10 · 10+.

### 5.5 `perfil_demografico`

Inclui (entre outros):

- Contagens/somas por sexo: admissões, desligamentos, saldo → doughnuts
- Faixas etárias admitidos/desligados → barras H
- Cruzamento sexo × faixa (`labels` + `series`) → barras agrupadas

### 5.6 `rankings`

| Chave | Uso |
|-------|-----|
| `contratacoes` / `desligamentos` / `saldo` | CBO top 15 |
| `admissoes_municipio` / `demissoes_municipio` / `saldo_municipio` / `estoque_municipio` | Município |
| `admissoes_regiao` / `demissoes_regiao` / `saldo_regiao` / `estoque_regiao` | Região |
| `estoque_disponivel` | Habilita opção Estoque nos selects |

Itens: `{ "label": "...", "valor": number }`.

### 5.7 `setores`

| Chave | Gráfico |
|-------|---------|
| `contratacoes_secao` / `desligamentos_secao` / `saldo_secao` | `#chartEstatsSecao` |
| `contratacoes_agregacao` / `desligamentos_agregacao` / `saldo_agregacao` | `#chartEstatsAgreg` |

### 5.8 `escolaridade` e `raca_cor`

Cada um com:

```json
{
  "contratacoes": [{ "label", "valor" }],
  "desligamentos": [...],
  "saldo": [...]
}
```

---

## 6. Inventário de gráficos (Chart.js)

| Canvas ID | Legenda | Tipo sugerido | Fonte de dados | Largura |
|-----------|---------|---------------|----------------|---------|
| `#chartEstatsFlut` | `#legendEstatsFlut` | line (2 séries) | `flutuacao_admissoes` + `flutuacao_desligamentos` | `span-2` |
| `#chartEstatsSalario` | `#legendEstatsSalario` | multi-line | `salario_medio` (+ ref estado) | `span-2` |
| `#chartEstatsVarAbs` | — | line | `variacao_absoluta_mes` | 1 col |
| `#chartEstatsVarRel` | `#legendEstatsVarRel` | line (± ref) | `variacao_relativa_mes` | 1 col |
| `#chartEstatsIndiceEnc` | `#legendEstatsIndiceEnc` | line (± ref) | `indice_emprego_encadeado` | `span-2` |
| `#chartEstatsTR` | `#legendEstatsTR` | line (± ref) | `taxa_rotatividade_mes` | `span-2` |
| `#chartEstatsPermanFaixa` | — | bar H | `permanencia.faixas_desligados` | 1 col / tall |
| `#chartEstatsPermanSerie` | `#legendEstatsPermanSerie` | multi-line | `permanencia.serie_mensal` | 1 col |
| `#chartEstatsAdmTipo` | — | bar H | `admissoes_por_tipo` | tall |
| `#chartEstatsDemTipo` | — | bar H | `desligamentos_por_tipo` | tall |
| `#chartEstatsDemTop4` | `#legendEstatsDemTop4` | multi-line | `desligamentos_top4_mensal` | `span-2` |
| `#chartEstatsAdmSexo` | — | doughnut | perfil sexo admissões | row-3 |
| `#chartEstatsDemSexo` | — | doughnut | perfil sexo desligamentos | row-3 |
| `#chartEstatsSaldoSexo` | — | doughnut / bar com sinal | perfil sexo saldo | row-3 |
| `#chartEstatsAdmFaixa` | — | bar H | faixa etária admitidos | tall |
| `#chartEstatsDemFaixa` | — | bar H | faixa etária desligados | tall |
| `#chartEstatsAdmSexoFaixa` | `#legendEstatsAdmSexoFaixa` | grouped bar | sexo × faixa adm | tall |
| `#chartEstatsDemSexoFaixa` | `#legendEstatsDemSexoFaixa` | grouped bar | sexo × faixa dem | tall |
| `#chartEstatsCbo` | — | bar H | `rankings` CBO por modo | `span-2` / tall |
| `#chartEstatsMunSaldo` | — | bar H | rankings município | `span-2` / tall |
| `#chartEstatsRegiao` | — | bar H | rankings região | `span-2` / tall |
| `#chartEstatsSecao` | — | bar H | `setores.*_secao` | `span-2` / tall |
| `#chartEstatsAgreg` | — | bar H | `setores.*_agregacao` | `span-2` / tall |
| `#chartEstatsEsc` | — | bar H | `escolaridade` | `span-2` / tall |
| `#chartEstatsRaca` | — | bar H | `raca_cor` | `span-2` / tall |

**Padrão de item:** `{ label: string, valor: number }`.  
**Séries multi-linha:** `{ labels: string[], series: [{ label, valores: number[] }] }`.

---

## 7. KPIs renderizados no front

Montados em `#dashEstatsKpis` a partir de `d.periodo` + `d.estoque_base`:

1. **Admissões (período)** — `periodo.admissoes` (`.val.pos`)
2. **Desligamentos (período)** — `periodo.desligamentos` (`.val.neg`)
3. **Variação absoluta (A − D)** — `periodo.variacao_absoluta`
4. **Variação relativa** — `periodo.variacao_relativa` (ou “—” se estoque indisponível)
5. **Variação acumulada desde 12/2025** — `indice_emprego_encadeado − 100`
6. **Taxa de rotatividade** — `periodo.taxa_rotatividade`
7. **Estoque fim do período** — `periodo.estoque_fim` (sub: estoque início)
8. **Estoque base (12/2025)** — `estoque_base.valor`

Quando `estoque_base.aplicavel === false` (ex.: filtro setorial), KPIs 4–8 mostram “—” / avisos.

---

## 8. Estado JS / cache em `window`

| Variável | Conteúdo |
|----------|----------|
| `dashEstatsCharts` | Mapa `key → Chart` (destroy ao redesenhar) |
| `window.__estatsSalario` | `d.salario_medio` |
| `window.__estatsRefEstado` | `d.referencia_estado` |
| `window.__estatsRankingsCbo` | fatia CBO de `d.rankings` |
| `window.__estatsRankingsMun` | fatia município |
| `window.__estatsRankingsRegiao` | fatia região |
| `window.__estatsSetores` | `d.setores` |
| `window.__estatsEsc` | `d.escolaridade` |
| `window.__estatsRaca` | `d.raca_cor` |

Funções-chave no template: `loadDashEstats`, `renderEstatsKpis`, `renderEstatsCboRanking`, `renderEstatsMunRanking`, `renderEstatsRegiaoRanking`, `renderEstatsSalario`, `renderEstatsSecao`, `renderEstatsAgreg`, `renderEstatsTriModo`, `wireSegModo`, `syncEstoqueSelectOptions`.

---

## 9. Regras de negócio essenciais

1. **Saldo CAGED:** `saldomovimentação = 1` admissão; `= -1` desligamento. Correções FOR/EXC entram no peso/saldo conforme script.
2. **Estoque encadeado:** `E_fim = E_inicio + saldo`; próximo mês `E_inicio = E_fim` anterior.
3. **TR:** `min(A, D) / E(1º dia) × 100` (proxy de reposição, não rastreio pessoa a pessoa).
4. **Índice na UI:** API devolve índice base 100; gráficos de “% acumulada” usam `índice − 100`.
5. **Filtro setorial (grande grupamento):** desliga estoque / variação relativa / índice / TR / ranking estoque.
6. **Sem filtro temporal:** por padrão restringe ao **ano mais atual** presente no arquivo.
7. **Salário:** média aparada (trim 5%) nas admissões.
8. **Permanência:** só desligamentos; campo `tempoemprego` em meses.

---

## 10. Padrões visuais a reutilizar

| Classe | Uso |
|--------|-----|
| `.panel` | Bloco de upload/filtros |
| `.filtros-box` / `__head` / `__body` / `__toggle` | Accordion |
| `.filtros-grid` / `.filtro-campo` / `.filtro-mun` | Grade de selects |
| `.kpi-grid` > `.kpi` > `.lbl` / `.val` / `.sub` | KPIs (`.pos` / `.neg`) |
| `.charts-grid` > `.chart-card` (+ `.span-2`) | Grid de gráficos |
| `.chart-wrap` (+ `.tall`) | Área do canvas |
| `.chart-seg button[data-modo].active` | Abas internas |
| `.chart-select` | Select de métrica |
| `.chart-legend` | Toggle de séries |
| `.progressBox.show` | Progresso |
| `.info-i[data-tip]` | Tooltip nos títulos/KPIs |

Cores Chart (JS): verde `#39B54A`, laranja `#F15A24`, azul `#0071BC`, cinza `#6D6E71`.

---

## 11. Fluxo sugerido para recriar

1. Montar o HTML da aba com os IDs desta especificação.
2. Implementar `GET .../opcoes` e popular os `<select multiple>`.
3. Implementar `GET .../resumo` com o payload da seção 5 (ou adaptar nomes, mantendo o contrato `{label, valor}`).
4. Renderizar KPIs (seção 7).
5. Desenhar gráficos na ordem da seção 6; segmentadores só trocam a fatia já em cache.
6. Tratar `estoque_base.aplicavel` para ocultar/desabilitar métricas dependentes de estoque.
7. Opcional: barra de progresso simulada enquanto a API responde (como `startEstatsProgress`).

---

## 12. Arquivos de referência no projeto origem

- UI: `app/templates/index.html` → `#tab-dashboard-estatisticas`
- Rotas: `app/servidor_caged.py` → `/api/dashboard/estatisticas-caged` e `.../opcoes`
- Cálculo: `scripts/dashboard_estatisticas_caged.py` → `resumo_estatisticas_caged`, `opcoes_filtros_estatisticas`
- Estoque: `scripts/estoque_ceara.py`
- Regiões/municípios: `scripts/ce_regioes.py` (+ CSV de regiões)
