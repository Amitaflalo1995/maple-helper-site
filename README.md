# Maple Helper website

The public download page for [Maple Helper](https://github.com/Maple-Helper/maple-helper): a static site with no build step and no dependencies.

Live at **https://www.maplehelper.app/**
English is the home page (`index.html`) and Hebrew lives in `he/index.html` (right-to-left).
`en/index.html` only sends old `/en/` links to `/` (Vercel also redirects `/en` with `vercel.json`).

```
(repository root)
  index.html            English page (home)
  he/index.html         Hebrew page (RTL)
  en/index.html         redirect from the old /en/ address to /
  404.html              "page not found"
  vercel.json           the /en -> / redirects
  assets/css/site.css   all styles, light and dark (follows the system setting)
  assets/js/site.js     optional extras: OS detection, install tabs, latest version, scroll reveal
  assets/shots/         app screenshots, rendered from the real Qt widgets (light and dark)
  assets/img/           icons, mascot, social preview image (og.jpg)
  favicon.ico, site.webmanifest, robots.txt, sitemap.xml, .nojekyll
```

The page works without JavaScript. The script only adds conveniences: on a Mac it makes the macOS
button the primary one and opens the macOS install tab; on a phone it shows a "open this on your
computer" note; it asks the GitHub API for the latest version number and shows it if the call succeeds.

## Preview locally

```
python -m http.server 8000
```

Run it in the repository root, then open http://localhost:8000/ (English) and http://localhost:8000/he/ (Hebrew).
Use a server rather than opening the file directly, so absolute paths and the version lookup behave
as they will online.

## Deploy

The site is hosted on **Vercel** at `https://www.maplehelper.app/`, connected to this repository:
every push to `main` deploys, and every pull request gets a preview. Project settings: no root
directory, Framework Preset *Other*, no build command, no output directory.

The canonical address `https://www.maplehelper.app/` is written into `index.html`, `he/index.html`
(canonical, `hreflang`, `og:*`, `twitter:image` and the JSON-LD block), `sitemap.xml` and `robots.txt`.
If the domain ever changes, search for `maplehelper.app` and update every hit. Also update `<lastmod>` in
`sitemap.xml` when the content changes.

Old addresses keep working: the app repository's `gh-pages` branch
(`maple-helper.github.io/maple-helper/`) holds only small pages that redirect to `www.maplehelper.app`.

The download buttons point at
`https://github.com/Maple-Helper/maple-helper/releases/latest/download/…`, which always serves the
newest release, as long as each release keeps the asset names `MapleHelper-Setup.exe` and
`MapleHelper-macOS.dmg`.

## Editing the content

- Text lives directly in the two HTML files (`index.html` and `he/index.html`). Keep them in step: same sections, same facts.
- In the Hebrew page, wrap every English word, number, version or file name inside a Hebrew sentence
  in `<bdi dir="ltr">…</bdi>` (for example `ל-<bdi dir="ltr">MapleStory Classic World</bdi>`), and key
  names in `<kbd>`. Keep a key and the punctuation right after it together with
  `<span class="nw"><kbd>F9</kbd>.</span>`. Avoid a leading dot on file types in Hebrew text
  (write `exe`, not `.exe`): next to Hebrew it reads as a misplaced full stop.
- The FAQ appears twice in each page: once as the visible `<details>` list and once in the
  `FAQPage` JSON-LD in `<head>`. If you change a question or an answer, change both.
- Colors are CSS variables at the top of `site.css`. Maple orange `#FF9533` / `#F07A12` is the only
  accent. Orange text uses the darker `--accent-text` so it stays readable (WCAG AA).

## Regenerating the screenshots

The screenshots are real renders of the app's Qt widgets (`Overlay`, `WishlistDialog`,
`SettingsDialog`) made with PySide6 and `widget.grab()`, light and dark. `assets/shots/*.webp` show
the Hebrew app (used by `he/index.html`); `assets/shots/en/*.webp` show the English app (used by
`index.html`). The English page also has its own social image, `assets/img/og-en.jpg`. They were made
with a throwaway `APPDATA` folder so no real user data is involved, then cropped to the window's
rounded edge (the app draws a transparent shadow margin around it) and saved as WebP. Re-render them
when the app's look changes, keeping the same file names and sizes, or update the `width`/`height`
attributes in the HTML.

## Credits

Game data and images courtesy of NiaMeowDB (meowdb.com). Font: Rubik (Google Fonts, SIL Open Font
License). Maple Helper is unofficial and not affiliated with Nexon; no Nexon or MapleStory logos
are used, only the game's name as text.

## Screenshots

`assets/shots/` is rendered from the real app windows by the app repository's tools:
`tools/site_shots.py` (raw PNGs) and `tools/site_shots_webp.py <raw_dir> <this repo>/assets/shots`.
