# PDFMaker

Web app full-stack per modificare file PDF: unire più documenti, riordinare, ruotare ed eliminare pagine, aggiungere testo e immagini con anteprima visuale WYSIWYG.

## Funzionalità

- **Caricamento multiplo** — trascina più PDF nella pagina o selezionali
- **Unione e riordino** — trascina le miniature per riordinare le pagine di tutti i file
- **Rotazione** — ruota ogni singola pagina di 90°
- **Eliminazione pagine** — rimuovi le pagine che non servono
- **Testo libero** — scegli strumento Testo, clicca sulla pagina, scrivi con dimensione, colore e grassetto configurabili (doppio clic per rieditare)
- **Immagini** — inserisci PNG/JPEG e ridimensionale trascinando l'angolino
- **Esportazione** — il PDF finale viene generato lato server ed è scaricabile subito

## Architettura

| Parte    | Tecnologia                                  |
| -------- | ------------------------------------------- |
| Backend  | Node.js + Express + Multer + pdf-lib        |
| Frontend | HTML/CSS/JavaScript puro + PDF.js (preview) |

Le anteprime sono renderizzate nel browser con PDF.js; tutte le modifiche strutturali e il disegno di testo/immagini vengono applicati dal backend con pdf-lib tramite un unico endpoint `POST /api/export` che riceve i file sorgente e una "spec" JSON (ordine pagine, rotazioni, annotazioni) e restituisce il PDF finale.

Il posizionamento gestisce correttamente le pagine ruotate: le coordinate sono convertite tra lo spazio di visualizzazione e quello nativo del PDF anche a 90°/180°/270°.

## Avvio

```bash
npm install
npm start
```

Apri http://localhost:3000 (porta configurabile con `PORT`).

```bash
PORT=8080 npm start
```

## API

### `GET /api/health`

Verifica di stato.

### `POST /api/export`

- `files` — uno o più PDF (multipart, campo `files`)
- `spec` — JSON con:
  - `pages`: `[{ file, page, rotation }]` ordine e rotazione (0/90/180/270) delle pagine del documento di uscita
  - `annotations`: `[{ kind: "text" | "image", page, x, y, ... }]` coordinate in punti PDF, origine alto-sinistra dello spazio visualizzato
    - testo: `text`, `size`, `color` (hex), `bold`
    - immagine: `w`, `h`, `image` (data URL PNG/JPEG)

Risposta: il PDF generato.
