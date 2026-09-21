#!/usr/bin/env python3
"""
Gera data/countries.json a partir da planilha "Mapa Mundial da Perseguição"
(exportada do Google Sheets em formato .xlsx).

Uso:
    python3 scripts/build_data.py caminho/para/planilha.xlsx

Requisitos:
    pip install openpyxl pycountry

O que o script espera encontrar na planilha:
  - Aba "GERAL": coluna A = nome do país (em português); demais colunas =
    um ano cada (ex.: 2013, 2014, ...), com o ranking daquele país naquele ano.
    Células vazias = país fora da lista naquele ano.
  - Aba "LISTAS": colunas PAÍS, CONTINENTE, REGIÃO, INGLÊS — com o nome do
    país batendo EXATAMENTE com o nome usado na aba GERAL (mesma grafia).

Como atualizar quando sair a lista de um novo ano:
  1. Na planilha (Google Sheets), na aba GERAL, adicione uma nova coluna com
     o ano e o ranking de cada país.
  2. Se algum país novo entrar na lista, adicione uma linha para ele também
     na aba LISTAS (país, continente, região, nome em inglês).
  3. Exporte a planilha: Arquivo → Fazer download → Microsoft Excel (.xlsx).
  4. Rode este script apontando para o arquivo baixado. Ele sobrescreve
     data/countries.json.
  5. Se algum país novo não tiver um código ISO3 conhecido, o script avisa
     no final — adicione o país ao dicionário OVERRIDES abaixo se necessário.
"""
import json
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Faltou instalar: pip install openpyxl pycountry")

try:
    import pycountry
except ImportError:
    sys.exit("Faltou instalar: pip install openpyxl pycountry")

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "countries.json"
FONTE = "Lista Mundial da Perseguição - Portas Abertas (portasabertas.org.br)"

# Ajustes manuais de país -> código ISO3, para casos em que a busca automática
# (pycountry) erra ou é ambígua. Adicione aqui se um país novo entrar na lista
# e o script reclamar no final.
# A aba GERAL às vezes usa um nome de país diferente do usado na aba LISTAS
# (ex.: "República Centro-Africana" numa aba e "Rep. C. Africana" na outra).
# Se o script avisar "sem entrada na aba LISTAS", ou padronize o nome nas duas
# abas da planilha, ou mapeie aqui: nome em GERAL -> nome em LISTAS.
NOME_ALIASES = {
    "República Centro-Africana": "Rep. C. Africana",
    "República Democrática do Congo": "Rep. Dem. Congo",
}

ISO3_OVERRIDES = {
    "North Korea": "PRK", "South Korea": "KOR", "Palestine": "PSE",
    "Türkiye": "TUR", "Turkey": "TUR", "Democratic Republic of Congo": "COD",
    "Republic of Congo": "COG", "Ivory Coast": "CIV", "Laos": "LAO",
    "Syria": "SYR", "Vietnam": "VNM", "Brunei": "BRN", "Russia": "RUS",
    "Iran": "IRN", "Bolivia": "BOL", "Venezuela": "VEN", "Tanzania": "TZA",
    "Moldova": "MDA", "United Kingdom": "GBR", "United States": "USA",
    "South Sudan": "SSD", "Eswatini": "SWZ", "Cape Verde": "CPV",
    "Micronesia": "FSM", "Myanmar": "MMR", "Central African Republic": "CAF",
    "Niger": "NER", "Nigeria": "NGA",
}


def numeric_of(iso3):
    """Código numérico ISO 3166-1 — usado para casar com o topojson do mapa."""
    try:
        c = pycountry.countries.get(alpha_3=iso3)
        return c.numeric if c else None
    except Exception:
        return None


def iso3_of(nome_ingles):
    if nome_ingles in ISO3_OVERRIDES:
        return ISO3_OVERRIDES[nome_ingles]
    try:
        return pycountry.countries.search_fuzzy(nome_ingles)[0].alpha_3
    except Exception:
        return None


def main():
    if len(sys.argv) != 2:
        sys.exit("Uso: python3 scripts/build_data.py caminho/para/planilha.xlsx")

    xlsx_path = Path(sys.argv[1])
    if not xlsx_path.exists():
        sys.exit(f"Arquivo não encontrado: {xlsx_path}")

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    if "GERAL" not in wb.sheetnames or "LISTAS" not in wb.sheetnames:
        sys.exit(f"A planilha precisa ter as abas GERAL e LISTAS. Abas encontradas: {wb.sheetnames}")

    ws_geral = wb["GERAL"]
    ws_listas = wb["LISTAS"]

    # --- LISTAS: país -> continente/região/inglês --------------------------
    listas = {}
    r = 2
    empty_streak = 0
    while empty_streak < 30:
        pais = ws_listas.cell(row=r, column=1).value
        if not pais:
            empty_streak += 1
            r += 1
            continue
        empty_streak = 0
        listas[pais.strip()] = {
            "continente": ws_listas.cell(row=r, column=2).value,
            "regiao": ws_listas.cell(row=r, column=3).value,
            "ingles": ws_listas.cell(row=r, column=4).value,
        }
        r += 1

    # --- GERAL: país -> {ano: ranking} --------------------------------------
    years_row = [ws_geral.cell(row=1, column=c).value for c in range(2, ws_geral.max_column + 1)]
    years = []
    for i, y in enumerate(years_row):
        if y in (None, ""):
            continue
        try:
            years.append((int(y), 2 + i))  # (ano, índice da coluna)
        except (TypeError, ValueError):
            continue

    countries = []
    missing_from_listas = []
    missing_iso = []
    r = 2
    empty_streak = 0
    while empty_streak < 20:
        pais = ws_geral.cell(row=r, column=1).value
        if not pais:
            empty_streak += 1
            r += 1
            continue
        empty_streak = 0
        pais = pais.strip()

        ranks = {}
        for ano, col in years:
            v = ws_geral.cell(row=r, column=col).value
            if v not in (None, ""):
                try:
                    ranks[ano] = int(v)
                except (TypeError, ValueError):
                    pass

        meta = listas.get(pais) or listas.get(NOME_ALIASES.get(pais, ""))
        if meta is None:
            missing_from_listas.append(pais)
            meta = {"continente": None, "regiao": None, "ingles": pais}

        iso3 = iso3_of(meta["ingles"] or pais)
        if not iso3:
            missing_iso.append(pais)

        sorted_years = sorted(ranks.keys())
        variacao_anual = {}
        prev = None
        for y in sorted_years:
            if prev is not None and prev in ranks:
                variacao_anual[y] = ranks[prev] - ranks[y]
            prev = y

        stats = {}
        vals = list(ranks.values())
        if vals:
            stats["rank_medio"] = round(sum(vals) / len(vals), 1)
            stats["melhor_rank"] = min(vals)
            stats["pior_rank"] = max(vals)
            stats["anos_na_lista"] = len(vals)
            stats["top10_pct"] = round(sum(1 for v in vals if v <= 10) / len(vals) * 100, 1)
            stats["var_total"] = ranks[sorted_years[0]] - ranks[sorted_years[-1]]

        countries.append({
            "id": iso3,
            "numeric": numeric_of(iso3) if iso3 else None,
            "nome_pt": pais,
            "nome_en": meta["ingles"] or pais,
            "continente": meta["continente"],
            "regiao": meta["regiao"],
            "ranks": {str(y): v for y, v in ranks.items()},
            "variacao_anual": {str(y): v for y, v in variacao_anual.items()},
            **stats,
        })
        r += 1

    all_years = sorted(y for y, _ in years)
    ultimo_ano = str(all_years[-1]) if all_years else None
    countries.sort(key=lambda c: c["ranks"].get(ultimo_ano, 999) if ultimo_ano else 999)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"years": all_years, "fonte": FONTE, "countries": countries}, f, ensure_ascii=False, indent=1)

    print(f"✅ {OUTPUT_PATH.relative_to(REPO_ROOT)} gerado com {len(countries)} países e {len(all_years)} anos "
          f"({all_years[0]}–{all_years[-1]}).")

    if missing_from_listas:
        print(f"\n⚠️  País(es) sem entrada na aba LISTAS (sem continente/região/inglês): {missing_from_listas}")
        print("   Adicione uma linha para eles na aba LISTAS e rode de novo.")
    if missing_iso:
        print(f"\n⚠️  País(es) sem código ISO3 identificado automaticamente: {missing_iso}")
        print("   Adicione-os em ISO3_OVERRIDES no topo deste script (nome em inglês -> código de 3 letras).")

    print("\nLembre-se de conferir também assets/flags/<ISO3>.svg para qualquer país novo "
          "(baixe de https://github.com/lipis/flag-icons/tree/main/flags/4x3 usando o código de 2 letras).")


if __name__ == "__main__":
    main()
