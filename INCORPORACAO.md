# Painel RAIS × CONDEC — referência para incorporação

Documento de funcionamento e de integração. Use-o quando for embutir esta página em outro site, portal ou aplicação, sem redescobrir contratos, regras e dependências.

O painel é uma **página web estática**. Não há API, banco, build nem `npm`. As bases de negócio são **três CSV na raiz**; o Python lê esses arquivos, cruza CONDEC × RAIS e materializa `dados/`. O mapa ainda lê `empresas_enderecos.csv` direto no navegador. No front, tudo roda em JavaScript global (`window.PainelDados`, `window.PainelGraficos`, `window.PainelMapa`).

---

## 1. O que o painel faz

Cruza os protocolos de incentivo fiscal do **CONDEC** com os estabelecimentos da **RAIS** (vínculos formais), pela chave **CNPJ de 14 dígitos**, e consolida filiais pela **raiz de 8 dígitos**.

O usuário recorta o estado (filtros combináveis). A cada mudança, o painel recalcula:

- indicadores (KPIs);
- mapa coroplético + pinos + ranking de municípios;
- gráficos ApexCharts;
- tabela com drill-down empresa → estabelecimentos.

O recorte padrão da competência é a **mais nova** presente na base (hoje `12/2025`). Qualquer competência pode ser marcada; indicadores, mapa e tabela usam só a mais nova entre as marcadas, para não somar estoques de anos diferentes. O gráfico de linhas e a série da comparação de salário usam **todas** as competências marcadas.

---

## 2. Como rodar (autônomo)

Requisito: **Python 3.7+** (biblioteca padrão) e um navegador. Não instale pacotes.

```bat
iniciar_painel.bat
```

```bash
py servidor.py                  # primeira porta livre a partir de 8000
py servidor.py --porta 9000
py servidor.py --etl            # regenera dados/ antes de servir
py servidor.py --sem-navegador
py etl/preparar_dados.py        # só o ETL
```

O servidor é **obrigatório**. `fetch` e MapLibre não funcionam em `file://`. As respostas saem com `Cache-Control: no-cache`.

Na subida, o `servidor.py` **lê os CSV da raiz** (`BASE_CONDEC.csv`, `base_rais.csv`, `empresas_enderecos.csv`) via `etl/preparar_dados.py` e regenera `dados/` se:

- faltar algum JSON derivado; ou
- qualquer um desses CSV (ou o próprio ETL) estiver mais novo que `dados/dimensoes.json`.

Sem os CSV, o destino não é independente: não dá para atualizar competências, protocolos nem pinos.

---

## 3. Arquitetura

A leitura começa nos CSV. `dados/*.json` é só o resultado compacto dessa leitura — não é a base a copiar para o outro projeto.

```
BASE_CONDEC.csv              ← ETL lê (vírgula, UTF-8 BOM)
base_rais.csv                ← ETL lê (ponto e vírgula, UTF-8 BOM)
empresas_enderecos.csv       ← ETL lê  e  o mapa lê de novo a cada recarga
geo/*.geojson                municípios, sedes, planejamento, postos IDT
        │
        ▼
etl/preparar_dados.py        lê os CSV, cruza pelo CNPJ, grava dados/
        │
        ▼
dados/*.json + unidades.geojson     (cache derivado; o navegador consome isto)
        │
        ▼
index.html
  css/map-layers.css + css/painel.css
  MapLibre 4.1.1 + ApexCharts 3.49.1 (CDN)
  js/painel-config.js        → window.MapLayersConfig
  js/map-layers-starter.js   → window.mapLayersApi
  js/painel-dados.js         → window.PainelDados
  js/painel-graficos.js      → window.PainelGraficos
  js/painel-mapa.js          → window.PainelMapa  (fetch em empresas_enderecos.csv)
  js/painel.js               → orquestra UI; window.PainelUI
```

O `base_rais.csv` (~86 MB, ~591 mil linhas) não entra no navegador. O ETL reduz a arrays paralelos. O front percorre um **índice de posições** (`Int32Array`) e só materializa objetos da página visível da tabela.

---

## 4. O que copiar para outro projeto

Para o destino ficar **independente**, copie os CSV da raiz e o ETL que os lê. Os JSON em `dados/` o próprio destino gera na primeira subida.

### 4.1 Bases CSV (obrigatórias)

Ficam na **raiz**, no mesmo nível de `index.html`.

| Arquivo | Quem lê | Função |
|---------|---------|--------|
| `BASE_CONDEC.csv` | `etl/preparar_dados.py` | 341 protocolos de incentivo |
| `base_rais.csv` | `etl/preparar_dados.py` | estabelecimentos, vínculos, salário, competências |
| `empresas_enderecos.csv` | ETL **e** `painel-mapa.js` (`fetch` sem cache) | lat/lon dos pinos CONDEC |

Não copie `cnpj_matrizes_filiais_condec_rais.csv` nem `geo/unidades_idt.csv`: o painel não os lê.

### 4.2 Código, mapa e ícones

Copie a árvore abaixo **mantendo a mesma hierarquia relativa a `index.html`**.

```
index.html
css/painel.css
css/map-layers.css
js/painel-config.js
js/map-layers-starter.js
js/painel-dados.js
js/painel-graficos.js
js/painel-mapa.js
js/painel.js
etl/preparar_dados.py
etl/reconstruir_base_rais.py         ← só se precisar rearmar base_rais.csv a partir de dados/
servidor.py                          ← opcional; qualquer HTTP estático serve depois do ETL
geo/ce_regioes.geojson
geo/CE_bacia_populacao.geojson
geo/regiao_planejamento.geojson
geo/unidades_idt.geojson
assets/location-office-solid.png
assets/pino-unidade.png
```

No destino: `py servidor.py` (ou `py etl/preparar_dados.py` e depois qualquer servidor). Isso lê os três CSV e cria `dados/`.

Não copie `node_modules` (não existe). Não há `package.json`.

### 4.3 Dependências externas (CDN)

Em `index.html`, no `<head>` e no fim do `<body>`:

| Recurso | URL atual |
|---------|-----------|
| MapLibre CSS | `https://unpkg.com/maplibre-gl@4.1.1/dist/maplibre-gl.css` |
| MapLibre JS | `https://unpkg.com/maplibre-gl@4.1.1/dist/maplibre-gl.js` |
| ApexCharts | `https://cdn.jsdelivr.net/npm/apexcharts@3.49.1/dist/apexcharts.min.js` |
| Tiles OSM | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| Satélite | tiles ArcGIS World Imagery (URL em `js/painel-config.js`) |

Se o projeto destino não puder usar CDN, hospede esses três arquivos e troque as tags. MapLibre e ApexCharts precisam existir **antes** dos scripts do painel.

### 4.4 Ordem obrigatória dos scripts

```html
<script src="…/maplibre-gl.js"></script>
<script src="…/apexcharts.min.js"></script>
<script src="js/painel-config.js"></script>
<script src="js/map-layers-starter.js"></script>
<script src="js/painel-dados.js"></script>
<script src="js/painel-graficos.js"></script>
<script src="js/painel-mapa.js"></script>
<script src="js/painel.js"></script>
```

`map-layers-starter.js` lê `window.MapLayersConfig` na carga. `painel.js` dispara `iniciar()` no `DOMContentLoaded`.

---

## 5. Leitura direta dos CSV

Os três arquivos abaixo são a fonte. Colunas exigidas e quem as lê.

### 5.1 `BASE_CONDEC.csv` (vírgula, UTF-8 BOM)

Lido por `etl/preparar_dados.py` → `ler_condec()`.

| Coluna | Uso |
|--------|-----|
| `ID` | identificador do protocolo |
| `CNPJ` | chave 14 dígitos |
| `CGF` | inscrição estadual (exibição) |
| `EMPRESA` | razão social do protocolo |
| `MUNICÍPIO` | join geográfico por nome, se o CNPJ não estiver na RAIS |
| `CNAE (ATIVIDADE PRINCIPAL)` | `código - descrição` (CNAE 2.0); setoriza incentivadas |
| `DATA INÍCIO` | ano → filtro `ini` e gráfico de safras |
| `VIGÊNCIA` | ano → filtro `fim` e calendário de vencimento |
| `PROGRAMA` | PROVIN, PCDM, PROADE, PIER (máscara de bits) |
| `EMPREGOS PI` | empregos comprometidos |
| `OBS` | texto |
| `Status` | situação do protocolo |
| `Parceira SPE` | SIM / NÃO |

### 5.2 `base_rais.csv` (ponto e vírgula)

Lido por `etl/preparar_dados.py` na raiz (`RAIS_CSV`). A coluna `Referência` alimenta o filtro **Referência da RAIS** (`12/2020`…`12/2025`). Cada valor distinto vira um item; a mais nova fica marcada como atual.

| Coluna | Uso |
|--------|-----|
| `CNPJ / CEI` | chave 14 dígitos |
| `Município - Código` | IBGE 6 dígitos |
| `CNAE 95 Classe - Código` / `Descrição` | setor dos não incentivados |
| `qtd_vinculos` | vínculos da linha **e** faixa de tamanho do estabelecimento |
| `Vl Rem Média Nom` | remuneração média nominal |
| `Razão Social` | busca e tabela |
| `Calçadista` | filtro e gráfico próprio |
| `Celetista ou Estatutário` | regime |
| `Natureza Jurídica - Código` | público / privado / NI |
| `Referência` | competência (ex.: `12/2025`); descoberta na leitura, sem lista fixa no código |

A descrição textual da faixa de tamanho **não** é usada: o código/texto do CSV da RAIS vem atrasado uma faixa. O ETL classifica por `qtd_vinculos` (`classe_tamanho`).

### 5.3 `empresas_enderecos.csv` (ponto e vírgula)

Leitura dupla, sempre do CSV:

1. `etl/preparar_dados.py` → `ler_coordenadas()`, grava pontos em `dados/unidades.geojson`;
2. `painel-mapa.js` → `fetch(cfg.urls.enderecos, { cache: "no-store" })` a cada recarga da página, para empresas novas no arquivo entrarem no mapa sem rerodar o ETL.

Campos usados: `cnpj` ou `cruz_cnpj`, `Status_Geocodificacao` (`ok`), `Latitude`, `Longitude`. Só entram pontos no retângulo do Ceará (lat −9…−2, lon −42…−37). Sem geocodificação válida, o protocolo cai na sede municipal.

---

## 6. Contrato dos arquivos em `dados/` (derivados dos CSV)

O navegador consome estes JSON **depois** que o ETL leu os CSV. Não substitua só o JSON se a fonte mudou: atualize o CSV e rode o ETL.

Todos os arrays de `estab_num.json` têm o mesmo comprimento `n`. A posição `i` é o estabelecimento.

### 6.1 `dimensoes.json`

Listas de categorias (setores, programas, municípios com região/sede/população, CNAEs, faixas, regimes, competências) e `totais` de conferência. Os **índices** dessas listas são o que as colunas numéricas guardam. Trocar a ordem das listas sem regenerar `estab_num.json` quebra o painel.

### 6.2 `estab_num.json`

| Coluna | Tipo no front | Significado |
|--------|---------------|-------------|
| `mun` | Int16 | índice em `dimensoes.municipios` (−1 se NI) |
| `cnae` | Int16 | índice em `dimensoes.cnaes` |
| `setor` | Uint8 | 0 Serviços … 5 Não identificado |
| `calc`, `tam`, `cele` | Uint8 | calçadista, faixa de tamanho, regime |
| `inc` | Uint8 | 0 não incentivado · 1 filial de raiz incentivada · 2 estabelecimento com protocolo |
| `sr` | Uint8 | 1 = protocolo sem linha na RAIS |
| `pp` | Uint8 | 1 = linha que **ancora** o protocolo (PI não duplica) |
| `prog` | Uint8 | bits dos programas (`1 << índice`) |
| `spe` | Uint8 | bit 1 = SIM, bit 2 = NÃO |
| `ini`, `fim` | Int16 | anos; 0 se não incentivado |
| `pi` | Int32 | empregos comprometidos **só se `pp = 1`** |
| `v`, `rem` | Int32 / Float32 | vínculos e remuneração média da linha |
| `raiz` | Int32 | índice em `estab_texto.raizes` |
| `ref` | Int8 | índice da competência; `−1` nos registros sem RAIS |
| `pub` | Uint8 | 0 privado · 1 público · 2 não informado |

### 6.3 `estab_texto.json`

Carregado **depois** da primeira pintura (é o arquivo mais pesado). Campos: `razao[]`, `cnpj[]`, `raizes[]`. Sem ele, busca por nome/CNPJ e rótulos da tabela ficam incompletos.

### 6.4 `empresas.json`

Uma entrada por raiz incentivada (`raiz`, `ridx`, `nome`, `protocolos[]`, totais). O mapa e os popups usam `empresaPorRaiz` indexado por `ridx`.

### 6.5 `dados/unidades.geojson`

Um ponto por protocolo CONDEC. Propriedades típicas: `cnpj`, `unidade`, `municipio`, `cod_ibge`, `programa`, `setor`, `pi`, `vinculos`, `rem`, `inicio`, `vigencia`, `spe`, `na_rais`, `geo`.

---

## 7. Regras de negócio (não negociar na incorporação)

1. **CNPJ.** Só dígitos, `zfill(14)` nas duas bases.
2. **Empresa.** Raiz = 8 primeiros dígitos. Filiais sem protocolo próprio recebem `inc = 1`.
3. **Recorte Incentivadas.** Só `inc = 2`. Filiais em municípios fora do CONDEC permanecem no recorte **Todos**.
4. **Protocolo ancorado.** Um CNPJ pode ter várias linhas na RAIS (CNAEs diferentes). `pi` só na primeira (`pp = 1`).
5. **Sem RAIS.** Protocolo sem match entra como linha com `sr = 1`, `v = 0`, `ref = −1`, para não sumir dos KPIs de compromisso nem da tabela.
6. **Setor.** Incentivada → CNAE 2.0 do protocolo. Demais → CNAE 95 da RAIS (divisões 01/02/05 agro; 10–41 indústria; 45 construção; 50–52 comércio; 55–99 serviços). Classe `99999` (CNAE 2.0 não convertido, rótulo “Cultivo de melão”) → Agropecuária, alinhada ao estoque CAGED do setor.
7. **Público.** Natureza jurídica 1xxx, empresa pública 201-1, economia mista 203-8, fundações 306-9 / 307-7 / 308-5 → público. Senão privado. Código vazio/0000/9999 → NI.
8. **Porte do estabelecimento.** Faixa pela `qtd_vinculos` da **linha daquela competência**, não pelo texto do CSV.
9. **Porte IBGE da empresa.** Soma de vínculos da **raiz** na competência ativa: micro ≤9, pequena 10–49, média 50–249, grande ≥250, sem vínculos.
10. **Remuneração.** Sempre `soma(rem × v) / soma(v)`, nominal da competência.
11. **Competências.** Estoque em 31/12, não fluxo. A competência ativa é a mais nova entre as marcadas (`sincronizarRefAtiva`).
12. **Pinos CONDEC.** Coordenada do CSV de endereços ou sede municipal. Vários protocolos no mesmo ponto viram um pino com `n` e popup em lista. **IDT não usa esse deslocamento.**

---

## 8. Ciclo de vida no navegador

```
DOMContentLoaded
    PainelDados.carregar(dimensoes + estab_num + empresas)
    preenche cabeçalho e filtros
    recalcular()
        idx = filtrar()
        grupos = agregarPorEmpresa(idx)
        KPIs, contador, tabela, gráficos, comparação, mapa
    PainelMapa.iniciar()          ← espera mapLayersApi.map
    esconde overlay de carga
    PainelDados.carregarTexto()   ← busca e nomes
    redesenha tabela e comparação
```

Qualquer filtro chama `aoAlterarFiltro()` → `recalcular()`. Não há roteador nem estado em URL (exceto âncoras do sumário: `#filtros`, `#kpis`, `#mapa`, `#graficos`, `#detalhamento`, `#notas`).

`filtrar({ ignorarRef: true })` é usado só nas séries temporais (referências marcadas, não só a ativa).

---

## 9. Estado dos filtros (`PainelDados.estado`)

| Campo | Valores | Efeito |
|-------|---------|--------|
| `incentivo` | `todos` / `inc` / `nao` | `inc` = só protocolo |
| `institucional` | `todos` / `priv` / `pub` | natureza jurídica |
| `setores`, `municipios`, `regioes`, `programas`, `tamanhos`, `portesIbge`, `celetistas` | `Set` de índices | vazio = todos |
| `calcadista`, `spe` | `todos` / `sim` / `nao` | |
| `iniDe`, `iniAte`, `fimDe`, `fimAte` | ano ou `null` | só linhas com ano > 0 |
| `busca` | texto | razão ou CNPJ (≥3 dígitos); exige `estab_texto` |
| `refs` | `Set` de índices | competências marcadas |
| `ref` | índice | competência ativa (mais nova das marcadas) |

Clicar no município no mapa (ou no ranking) chama `PainelUI.filtrarMunicipio`, que preenche o multi de município e recalcula o painel inteiro.

O recolhimento da barra de filtros fica no `localStorage`.

---

## 10. Interface: seções, IDs e gráficos

A página é um `main.shell` com largura máxima (`--conteudo: 1920px`). Grade de gráficos em **2 colunas**; cards largos usam `grade__item--largo` (`grid-column: 1 / -1`).

### 10.1 KPIs (`#kpis`)

Gerados em `painel.js` (`renderKpis`). Incluem empresas incentivadas, estabelecimentos, PI, vínculos de incentivadas, aderência ao compromisso, remuneração, recorte do estado e alerta de protocolos sem RAIS (abre `#dialogoSemRais`).

### 10.2 Mapa (`#mapa`, canvas `#mapCanvas`)

Starter (`map-layers-starter.js`): OSM, satélite, polígonos, linha de planejamento, pinos incentivados, pinos IDT, círculos das sedes, toggles.

Painel (`painel-mapa.js`): coropleta por `feature-state` (não reenvia os polígonos a cada filtro), paleta, legenda, popups, filtro dos pinos pelo recorte.

Métricas (`#mapaMetrica`): vínculos do recorte, % incentivadas no emprego municipal (denominador = total da competência **sem** os outros filtros), remuneração média, empregos comprometidos.

Toggles (IDs fixos — o starter os procura por id):

| ID | Camada | Padrão |
|----|--------|--------|
| `mapTogglePlanejamento` | linha de planejamento | off |
| `mapToggleUnidades` | pinos CONDEC (`location-office-solid.png`, `icon-size` 0.06875 ≈ 35 px) | on |
| `mapToggleUnidadesIdt` | postos IDT (`pino-unidade.png`) | off |
| `mapToggleSedes` | sedes municipais | off |

Clique no pino abre empresas daquele ponto. Clique no polígono filtra o painel.

### 10.3 Gráficos (`#graficos`)

Todos em `js/painel-graficos.js`. `G.render(idx, grupos)` redesenha o conjunto. Donut/pie/radialBar são **destruídos e recriados** (o ApexCharts inflava a largura com uma fatia só). Demais usam `updateOptions`.

| ID do div | Conteúdo |
|-----------|----------|
| `graficoReferencia` | linhas de vínculos e remuneração nas competências marcadas |
| `graficoCompBarras` / `graficoCompLinhas` | até 6 empresas; abas maiores/menores salários |
| `graficoDispersao` | PI × vínculos observados (log/linear) |
| `graficoGauge` | aderência global (radial) |
| `graficoAderencia` | 20 piores aderências |
| `graficoSetor` | composição setorial |
| `graficoRemSetor` | remuneração por setor |
| `graficoBoxRem` | boxplot **oculto** (`hidden`; sem chamada em `render`) |
| `graficoHeatmap` | município × setor |
| `graficoMunicipios` | 15 municípios com mais vínculos incentivados |
| `graficoRegioes` | empresas ou vínculos por região (abas) |
| `graficoProgramas` | programas |
| `graficoTreemap` | setor → programa |
| `graficoTamanho` | faixa do estabelecimento |
| `graficoPorteIbge` | barras de vínculos + linha de empresas (porte IBGE) |
| `graficoSafras` | protocolos por ano de início |
| `graficoVigencias` | vencimentos 2025–2032 |
| `graficoCalcadista` | recorte calçadista |
| `graficoRegime` | rosca celetista / estatutário / outros |
| `graficoInstitucional` | rosca privado / público / NI |

Rótulos de rosca e de porte IBGE: valor compacto + fundo claro; se dois números se encostam, o de cima sobe.

### 10.4 Tabela (`#detalhamento`)

Modos empresa / estabelecimento. Ordenação por coluna. Paginação 50. Janela visível de 10 linhas com cabeçalho sticky. Drill-down na linha da empresa. Exportação CSV do recorte.

---

## 11. Globais e pontos de extensão

| Global | Arquivo | Papel |
|--------|---------|--------|
| `MapLayersConfig` | `painel-config.js` | URLs, IDs de camada, cores, `bounds` do Ceará |
| `mapLayersApi` | `map-layers-starter.js` | `{ map, … }` depois do `load` |
| `PainelDados` | `painel-dados.js` | carga, `estado`, `filtrar`, agregações |
| `PainelGraficos` | `painel-graficos.js` | `render`, `fmt`, setters de abas |
| `PainelMapa` | `painel-mapa.js` | `iniciar`, `atualizar` |
| `PainelUI` | `painel.js` | `{ filtrarMunicipio }` |

Para outro projeto **só reaproveitar o mapa**, use o kit (`js/config.js` + `html/demo.html` + `html/toggles-snippet.html`). O painel usa `painel-config.js` (caminhos a partir da raiz do site).

Caminhos relativos à URL da página:

```js
// CSV lido direto pelo mapa (js/painel-config.js)
enderecos: "empresas_enderecos.csv"

// JSON derivados dos CSV (js/painel-dados.js) — o ETL grava isto
CAMINHOS = {
  dimensoes: "dados/dimensoes.json",
  num: "dados/estab_num.json",
  empresas: "dados/empresas.json",
  texto: "dados/estab_texto.json",
}

// js/painel-config.js → urls.municipios, unidades, unidadesIdt, sedes,
// planejamento, pinIcon, industriaIcon, enderecos
```

Se a página ficar em `/app/rais/`, hospede os **CSV da raiz**, `dados/`, `geo/`, `js/`, `css/` e `assets/` nesse prefixo **ou** altere esses objetos.

---

## 12. Três jeitos de incorporar

### A. Iframe (menor risco)

Sirva a pasta do painel como site estático (`https://seu-dominio/rais/` ou um `http.server` interno) e embuta:

```html
<iframe
  src="https://seu-dominio/rais/"
  title="Painel RAIS × CONDEC"
  style="width:100%;height:100vh;border:0"
></iframe>
```

Vantagens: CSS e `100vh` do mapa não brigam com o layout pai; scripts globais não vazam. Desvantagens: scroll interno; sem tema compartilhado; precisa de URL HTTP.

Ajuste o sumário lateral (`.sumario`) se o iframe for estreito.

### B. Subárvore no mesmo host (recomendado para portal interno)

1. Copie os três CSV da seção 4.1, o ETL e o pacote 4.2 para `/rais/` (ou o path que quiser).
2. Rode `py servidor.py` ou `py etl/preparar_dados.py` nesse diretório (lê os CSV).
3. Aponte o menu do portal para `/rais/`.
4. Garanta MIME: `.js` → JavaScript, `.json` → JSON, `.csv` → texto, `.geojson` → `application/geo+json`.
5. Não ponha cache longo nos CSV nem em `dados/` se for atualizar bases com frequência.

Não misture o `<body>` do painel com o do portal. O painel assume `html/body` próprios (`overflow-x: hidden`, fonte do sistema, variáveis em `painel.css`).

### C. Embutir o markup no layout do outro sistema

Só faça se puder:

1. Trazer **todo** o HTML de `index.html` (os IDs são o contrato da UI).
2. Carregar os dois CSS. Prefixe ou isole se houver colisão (`.shell`, `.kpi`, `.seg`, `.multi`, `.mapa-…`, `.map-ce-…`).
3. Manter a ordem dos scripts.
4. Não carregar outro ApexCharts/MapLibre de versão diferente na mesma página.
5. Corrigir caminhos se o HTML não estiver na raiz do host.
6. Reservar altura para `#mapCanvas` (o mapa estica até a altura do ranking via flex + `ResizeObserver` → `map.resize()`). Sem altura, o mapa nasce com 0 px.

Não existe `init({ container })`. O starter instancia MapLibre em `#mapCanvas`.

---

## 13. Servir no projeto destino

Qualquer servidor estático serve, desde que:

- não abra como arquivo local;
- não bloqueie os CDNs (ou os arquivos estejam locais);
- os três CSV da raiz estejam no mesmo host que o `index.html`;
- `empresas_enderecos.csv` responda a `GET` (o mapa o busca a cada recarga).

Exemplos:

```nginx
location /rais/ {
  alias /var/www/rais/;
  add_header Cache-Control "no-cache";
  types { application/geo+json geojson; }
}
```

```js
// Express
app.use("/rais", express.static(path.join(__dirname, "rais"), {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));
```

SPA com history API: configure exceção para `/rais/*` (arquivos reais). Se o router engolir `base_rais.csv`, `BASE_CONDEC.csv`, `empresas_enderecos.csv` ou `dados/estab_num.json`, o painel não sobe ou o ETL não roda.

---

## 14. Layout, CSS e conflitos

- Variáveis e reset estão em `css/painel.css`. O mapa reutiliza `css/map-layers.css`.
- Largura de referência: `--conteudo: 1920px` no topo e no shell.
- Cards: `min-width: 0` para a grade de 2 colunas não estourar.
- Donuts com 1 fatia: destroy + recreate (já no código).
- Navegação fixa: `.sumario` à esquerda. No iframe estreito, pode sobrepor conteúdo — teste.
- Filtros sticky no topo da página (`z-index: 30`).

Se o portal já tiver MapLibre, **não** inicialize dois mapas no mesmo canvas.

---

## 15. Atualizar dados depois de incorporar

1. Substitua o CSV correspondente na raiz (`BASE_CONDEC.csv`, `base_rais.csv` e/ou `empresas_enderecos.csv`).
2. Na raiz do painel: `py etl/preparar_dados.py` (lê de novo os CSV).
3. Publique os CSV atualizados e a pasta `dados/` gerada.
4. Recarregue o navegador (sem cache agressivo). Pinos novos em `empresas_enderecos.csv` entram no mapa mesmo sem o passo 2.

Uma competência nova na RAIS entra sozinha nas listas; o default continua a mais nova.

Confira os totais que o ETL imprime (ordem de grandeza atual):

| Medida | Valor de referência |
|--------|--------------------:|
| Linhas da RAIS | 111.835 |
| Vínculos | 2.068.766 |
| Protocolos CONDEC | 341 |
| Raízes incentivadas | 307 |
| Match exato de CNPJ | 321 |
| Estabelecimentos das raízes | 532 na RAIS + 20 sem registro |
| Vínculos das raízes | 134.231 |
| Empregos comprometidos | 81.317 |

Se divergirem, a origem mudou ou o cruzamento quebrou.

---

## 16. Checklist de incorporação

- [ ] Pasta servida por HTTP (não `file://`).
- [ ] `BASE_CONDEC.csv`, `base_rais.csv` e `empresas_enderecos.csv` na raiz, ao lado de `index.html`.
- [ ] Hierarquia `js/`, `css/`, `etl/`, `geo/`, `assets/` relativa ao HTML.
- [ ] ETL rodado no destino (`py servidor.py` ou `py etl/preparar_dados.py`) para ler os CSV.
- [ ] MapLibre + ApexCharts carregados antes dos scripts do painel, na ordem da seção 4.4.
- [ ] MIME de `.geojson` e `.js` corretos.
- [ ] `#mapCanvas` no DOM, com altura.
- [ ] Toggles do mapa com os IDs da seção 10.2, se a barra for copiada.
- [ ] CDN liberado ou arquivos locais.
- [ ] `GET` de `empresas_enderecos.csv` liberado (pinos fora da sede).
- [ ] Sem segundo MapLibre/ApexCharts conflitante na mesma página (modo C).
- [ ] Teste: carga, um filtro de município, clique no mapa, busca, exportação CSV, abas de salário, pinos.

---

## 17. Limitações conscientes

- Sem autenticação, sem backend, sem persistência de recorte (só o recolhimento dos filtros).
- Sem i18n; textos e `Intl` em `pt-BR`.
- Sem testes automatizados.
- Boxplot de remuneração existe no HTML mas está desligado.
- Coordenadas CONDEC sem geocodificação válida **não** são o endereço da fábrica — são a sede do município (com possível agrupamento de pinos).
- Desempenho pensado para ~100 mil estabelecimentos **já indexados** no cliente. O navegador não lê `base_rais.csv` nem `BASE_CONDEC.csv`; só o ETL e, no mapa, `empresas_enderecos.csv`.
- Se `base_rais.csv` se perder, `py etl/reconstruir_base_rais.py` remonta as colunas que o ETL usa a partir de `dados/` (natureza jurídica só na classe público/privado/NI).

---

## 18. Arquivos de apoio neste repositório

| Arquivo | Quando usar |
|---------|-------------|
| `README.md` | visão geral + kit isolado do mapa |
| `INCORPORACAO.md` | este guia |
| `html/demo.html` | mapa sem dados de negócio |
| `html/toggles-snippet.html` | só a barra de camadas |
| `js/config.js` | config do kit (caminhos `../`) |
| `schemas/unidades-pontos.schema.md` | schema dos pontos |
| `kpimelhorias.md` | notas históricas de layout/KPI |

Para integrar **só o mapa do Ceará** em outro produto, comece pelo kit da segunda metade do `README.md`. Para integrar **o painel inteiro**, copie os CSV da seção 4.1, o pacote 4.2 e siga o modo A ou B.
