# Mapa Mundial da Perseguição

Dashboard interativo com o histórico (2013–2026) da **Lista Mundial da Perseguição**, publicada anualmente pela [Portas Abertas](https://portasabertas.org.br/lista-mundial/paises-da-lista/), que ranqueia os 50 países onde é mais difícil ser cristão — do nº 1 (maior nível de perseguição) ao nº 50.

🔗 **Demo:** publique este repositório no GitHub Pages (veja abaixo) e o link ficará em `https://<seu-usuario>.github.io/<nome-do-repositorio>/`.

## O que o dashboard mostra

- **Mapa-múndi interativo**, com os países coloridos conforme o ranking do ano selecionado — vermelho (perseguição extrema, ranking próximo de 1) até verde (fora do topo 50 / ranking mais alto), passando por laranja e amarelo no meio da escala.
- **Controle de ano** (2013 a 2026): o mapa e a lista lateral se atualizam automaticamente.
- **Lista lateral** com o ranking completo do ano, variação frente ao ano anterior, filtro por continente e busca por país.
- **Página de detalhes do país** (ao clicar no mapa ou na lista): nome completo, continente, região, ranking atual, melhor/pior posição no período, variação anual e um **gráfico de evolução do ranking** ano a ano, com tooltip interativo.
- Espaço reservado para, futuramente, adicionar descrição, histórico e imagens de cada país.

## Fonte dos dados

Os dados de ranking (`data/countries.json`) foram extraídos da planilha "Mapa Mundial da Perseguição" (exportada do Google Sheets, aba **GERAL**, com apoio das abas **LISTAS** — continente/região/nome em inglês) e reorganizados em JSON. A fonte primária é sempre a Lista Mundial da Perseguição da Portas Abertas: https://portasabertas.org.br/lista-mundial/paises-da-lista/

> Estatísticas derivadas (melhor/pior posição, média, variação) são calculadas diretamente a partir dos rankings ano a ano — não da aba auxiliar "DADOS" da planilha original, cujos valores calculados via fórmulas não vieram consistentes na exportação.

## Estrutura do projeto

```
mapa-mundial-perseguicao/
├── index.html              # página única (mapa + lista + detalhe do país)
├── assets/
│   ├── css/style.css       # estilos (tema claro/escuro automático)
│   ├── js/app.js           # lógica do mapa, lista, roteamento e gráfico
│   └── vendor/             # d3.js e topojson-client (vendorizados, sem depender de CDN)
├── data/
│   ├── countries.json      # dataset final: ranking por país e por ano
│   └── world-110m.json     # geometria do mapa-múndi (Natural Earth / world-atlas)
└── README.md
```

Não há build step — é HTML/CSS/JS puro, então basta publicar a pasta como está.

## Como publicar no GitHub Pages

1. Crie um repositório público no GitHub (ex.: `mapa-mundial-perseguicao`).
2. Envie o conteúdo desta pasta para a branch `main`:
   ```bash
   git init
   git add .
   git commit -m "Mapa Mundial da Perseguição"
   git branch -M main
   git remote add origin https://github.com/andrescultori/mapa-mundial-perseguicao.git
   git push -u origin main
   ```
3. No GitHub, vá em **Settings → Pages**, selecione a branch `main` e a pasta `/ (root)`.
4. Aguarde alguns minutos — o site ficará disponível em `https://andrescultori.github.io/mapa-mundial-perseguicao/`.

## Atualizando os dados em um novo ano

Quando a Portas Abertas divulgar a lista de um novo ano:

1. Adicione a nova coluna de ranking na planilha de origem (aba `GERAL`).
2. Reexporte/gere `data/countries.json` (o script de extração usado está descrito nos comentários do arquivo; qualquer script Python com `openpyxl` que leia a aba `GERAL` e monte `{ano: ranking}` por país resolve).
3. Adicione o novo ano em `years` no topo do JSON.
4. Publique — o dashboard reconhece automaticamente os novos anos no seletor.

## Próximos passos sugeridos

- Adicionar descrição, contexto histórico e foto de cada país na seção "Sobre o país" da página de detalhes.
- Adicionar link direto para o perfil de cada país no site da Portas Abertas.
- Internacionalização (EN) da interface.

---

Desenvolvido por [André Scultori](https://github.com/andrescultori) · © 2026 · [GitHub](https://github.com/andrescultori/mapa-mundial-perseguicao)
