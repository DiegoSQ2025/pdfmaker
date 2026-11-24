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

## Uso online (senza installare nulla)

Il frontend elabora i PDF direttamente nel browser (pdf-lib + PDF.js via CDN), quindi il sito funziona anche **senza backend**:

1. Abilita GitHub Pages sul repository: **Settings → Pages** → Source: *Deploy from a branch* → branch `main`, cartella `/ (root)` → Save
2. L'app sarà raggiungibile all'indirizzo `https://<utente>.github.io/pdfmaker/`

Alternativa senza configurazione: apri il repository su [CodeSandbox](https://codesandbox.io/s/github/DiegoSQ2025/pdfmaker) o [StackBlitz](https://stackblitz.com/github/DiegoSQ2025/pdfmaker), che eseguono il server Node nel browser senza installare nulla sul tuo PC.

## Avvio locale (opzionale)

L'avvio locale serve solo se preferisci l'elaborazione lato backend:

```bash
npm install
npm start
```

Apri http://localhost:3000 (porta configurabile con `PORT`). Non richiede permessi di amministratore e non installa nulla a livello di sistema: le dipendenze vivono nella cartella `node_modules` del progetto.

> Se il backend non risponde (es. su Pages), l'app passa automaticamente alla generazione del PDF nel browser.

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
