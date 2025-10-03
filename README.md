# Simple Wiki

A simple and friendly internal wiki that reads Markdown (.md) articles from a Google Drive folder and displays them as a website with navigation, search, and a word cloud.

✅ Fast title-based search

✅ Article index and per-page table of contents

✅ “Latest articles” by update date

✅ Highlighted code blocks and Markdown tables

✅ Automatic frequent terms word cloud

✅ Works only with your Google account (Apps Script)


## 1) What do I need?

* A Google account (Gmail or organizational).
* Permission to create a Google Apps Script project.
* A Google Drive folder where your `.md` articles will be stored.

**No programming knowledge required: you’ll just copy/paste two files (frontend and backend) and change a couple of settings.**


## 2) How to install (10–15 minutes)

### Step 1 — Create the project in Apps Script

Go to [script.google.com](https://script.google.com) → New project.

Rename it to something like **Simple Wiki**.

### Step 2 — Add the files

* Create an HTML file named **Index** and paste the frontend code.
* Create a Google Apps Script file named **server.gs** and paste the backend code.
* Save.

(If you already have these files, just check the parameters in the next step.)

### Step 3 — Configure folder and title

* In Google Drive, create a folder for the articles (e.g., **Wiki GEM**).
* Copy the folder ID (the long part in the URL).
* In `server.gs`, at the top, replace:

```js
const CONTENT_FOLDER_ID = 'PASTE_YOUR_FOLDER_ID_HERE';
```

(Optional) Change the wiki title in a single place (used across the app):

```js
function getScriptConfig() {
  return { title: 'Simple Wiki', tz: Session.getScriptTimeZone() };
}
```

### Step 4 — Enable “Advanced” Drive services

For metadata (last edit, author) and better file handling:

* Menu → Google Advanced Services → Drive API → Enable.
* Then follow the link to Google Cloud Platform and also enable **Google Drive API** there.

### Step 5 — Publish as “Web App”

* Deploy → New deployment.
* Type: **Web App**.
* Execute as: **Me**.
* Who can access:

  * Internal use: Anyone in your organization.
  * External sharing: Anyone with the link.

Save and copy the Web App URL (this will be your wiki site).

If you make changes: go back to **Deploy** → **Manage deployments** → New version.

## 3) Uploading content (Markdown)

* Inside your content folder, upload text files with the `.md` extension (e.g., `getting-started.md`).
* The title is taken from the file name (capitalized automatically).
* For images: upload them to Drive and paste the link in your `.md`.
* The app optimizes Drive links for fast thumbnails.
* If an image doesn’t show: make sure it’s set to “anyone with the link” (or at least visible within your domain).

### Supported Markdown

* Headings `#`, `##`, `###`, lists, links, bold and italic.
* Code blocks with triple backticks:

```js
console.log("hello");
```

* GitHub-style tables:

| Column | Value |
| ------ | ----- |
| A      | 1     |
| B      | 2     |

* “Notes” / info boxes with simple tags:

```html
<note>
This is an important reminder.
</note>

<warning>
Be careful with X.
</warning>

<important>
Critical for production.
</important>
```

## 4) How to use

* **Search**: top-right field (filters by title).
* **Index**: left panel (alphabetical order).
* **Latest articles**: left panel, below index (by last edited date).
* **Word cloud**: on the homepage, built from all `.md` files.

## 5) Quick customization

* **Title and browser tab**: change the `title` in `getScriptConfig()` (see step 3).
* **Favicon**: one is embedded by default; replace the `<link rel="icon" …>` in `Index.html` with another data URL if needed.
* **Light/dark theme**: currently set to light theme; you can adjust with CSS.

## 6) Maintenance

* To add/edit an article: upload a new `.md` or edit an existing one.
* To delete: remove the `.md` file from the folder.
* Word cloud and “Latest articles” update automatically (short cache for speed).

## 7) Troubleshooting

* **No articles showing** → Check that `CONTENT_FOLDER_ID` is correct and files end with `.md`.
* **Word cloud delay or “Retry”** → Normal with large folders. Try clicking “Retry” or update a file and reload.
* **Images not loading** → Make sure Drive permissions are set to visible with link (at least within your domain).
* **Empty metadata (author/date)** → Check that Advanced Drive API is enabled in both Apps Script Services and Google Cloud Platform.

## 8) Project structure

```
/ (Apps Script Project)
├─ Index.html    # Frontend UI and styles
├─ server.gs     # Backend: Drive reading, cache, API
└─ (Drive folder with .md content)
```

## 9) License & credits

**MIT License**
**Author:** Pablo Niklas [pablo.niklas@gmail.com](mailto:pablo.niklas@gmail.com)

## Quick install checklist

* Create Apps Script project
* Paste `Index.html` and `server.gs`
* Configure `CONTENT_FOLDER_ID`
* (Optional) Change title in `getScriptConfig()`
* Enable Drive API (Advanced Services)
* Deploy as Web App
* Upload `.md` files and open your wiki URL
