# Makieta 3D osiedla (BOR2): podstrona web

Interaktywna makieta osiedla w przeglądarce (three.js), zbudowana od zera z modeli SketchUp dewelopera. Wygląd jest odebrany przez kontrolę wizualną względem `referencje_wizualizacji/` (protokoły: `kontrola_wizualna/odbior-zewnetrza.md`, `kontrola_wizualna/odbior-wnetrz.md`).

## Uruchomienie

```
cd web
npm install
npm run dev      → http://localhost:5180/
npm run build    → web/dist/ (statyczne pliki do wgrania na dowolny hosting)
```

## Funkcje

- **Zdjęcie ↔ Makieta 3D**: zdjęcie lotnicze z obrysami domów; kamera 3D jest dopasowana do zdjęcia, więc przejście jest płynne.
- **Spacer po osiedlu**: klik w teren przenosi kamerę na wysokość oczu; u góry nazwane punkty.
- **Dom**:
  - widok bryły;
  - **piętro z góry** i **parter z góry** (bez dachu, ściany w pełnej wysokości, nazwy pomieszczeń);
  - **rzut**;
  - **spacer we wnętrzu** (start w kadrach renderów);
  - galeria;
  - karta domu.
- **Pory dnia**: Rano / Dzień / Noc (zmierzch z ciepłymi oknami i lampami ogrodowymi).
- **Nasłonecznienie**: prawdziwe słońce dla wybranego miesiąca i godziny (52,2°N, czas CET/CEST); cienie przypięte do stron świata.
- **Pozostałe**: kompas, zoom, zrzut ekranu, ukrywanie etykiet, notka „Położenie budynków poglądowe”.
- **Stan w adresie**, np. `#/dom/B?kond=1`, `#/dom/G?tryb=spacer&punkt=PKT_0_SALON`, `#/osiedle?zdjecie=0&nasl=12-12`.
- Działa na komputerze i telefonie.

## Do uzupełnienia przez klienta

- **Metraże i ceny domów A, B** (oraz C i G, jeśli mają być pokazane): `web/src/data/domy.ts`.
- **Azymut działki z mapy** (SKP ma North Angle = 0° bez georeferencji): `KAT_PN` w `web/src/lib/slonce.ts`; obraca razem słońce Nasłonecznienia i kompas.

## Limit 100 MB na plik (GitHub)

GitHub odrzuca pliki większe niż 100 MB. Dziś największy plik w repozytorium ma ok. 17 MB, ale zabezpieczenie działa na przyszłość:

- `npm run sprawdz-rozmiary` (w `web/`): kontrola plików w indeksie gita, ostrzeżenie powyżej 50 MiB, błąd powyżej 95 MiB.
- Hook przed commitem `web/.githooks/pre-commit` robi to samo automatycznie. Włącz go raz ręcznie: `git config core.hooksPath web/.githooks`.
- `npm run podziel-duze` (w `web/`): model z `manifest.json` większy niż 95 MiB zostaje podzielony na części `*.czesc-01…` (po 90 MiB), opisane w `web/public/models/czesci.json`. Skrypt aktualizuje też białą listę `.gitignore`. Aplikacja skleja części przy wczytywaniu, z postępem w MB na ekranie ładowania, więc model działa bez zmian. Oryginał usuń z indeksu: `git rm --cached web/public/models/<plik>`.

## Struktura

| Katalog | Zawartość |
|---|---|
| `web/` | aplikacja (Vite + React + three.js / R3F) |
| `web/public/models/` | modele GLB + `manifest.json` (która wersja jest używana) |
| `pipeline/`, `work/` | konwersja zewnętrza SKP → Blender → GLB |
| `pipeline_wnetrza/`, `work_wnetrza/` | konwersja wnętrz, materiały, wypalone światło (Cycles) |
| `kontrola_wizualna/` | standard wizualny, raporty iteracji, narzędzie pomiaru ΔE, protokoły odbioru |
| `tools/` | zrzuty z GPU, kalibracja kamery zdjęcia, obrysy, arkusze |
| `docs/` | kontrakt i koordynacja (`00`), analiza materiałów (`01`), opis aplikacji (`02`), dziennik iteracji (`03`), `CHANGELOG.md` modeli |

## Jakość (pomiar ΔE CIELAB względem renderów dewelopera)

| | Start | Odbiór |
|---|---|---|
| Elewacje | 7/22 regionów w progu, ΔE 20,4 | 24/25, ΔE 6,7 |
| Wnętrza | 4/14, ΔE 13,8 | 29/30, ΔE 6,0 |

Zestaw regionów pomiarowych rozszerzano w trakcie prac o kolejne kadry (elewacje 22 → 25, wnętrza 14 → 30), dlatego porównuj przede wszystkim średnie ΔE. Szczegóły i tolerancje: `docs/03-iteracje.md` i protokoły odbioru.
