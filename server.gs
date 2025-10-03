// ============ CONFIG ==========
const APP_TITLE = (
  PropertiesService
    .getScriptProperties()
    .getProperty('APP_TITLE')
) || 'Simple Wiki';

const CONTENT_FOLDER_ID = (
  PropertiesService
    .getScriptProperties()
    .getProperty('CONTENT_FOLDER_ID')
) || '';; // carpeta con los .md

const CACHE_TTL_SECONDS = 60; // 10 min de caché para el índice
const CACHE_ID = "SimpleWiki"
const DEBUG_META = true;

// ============ PÚBLICO =========
/**
 * Función principal que se ejecuta al recibir una petición GET.
 * Sirve la página principal de la wiki o actúa como proxy para imágenes
 * si se provee el parámetro 'img' en la URL.
 * @param {object} e El objeto de evento de la petición GET.
 * @returns {HtmlService.HtmlOutput|ContentService.TextOutput} El servicio HTML para la página principal o el contenido de la imagen.
 */
function doGet(e) {
  // Proxy de imágenes: /exec?img=<FILE_ID>
  if (e && e.parameter && e.parameter.img) {
    return serveImage_(e.parameter.img);
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Sirve un archivo de imagen desde Google Drive de forma segura.
 * Verifica que el archivo pertenezca a la carpeta de contenido antes de devolverlo
 * y añade cabeceras de caché.
 * @private
 * @param {string} fileId El ID del archivo de imagen en Google Drive.
 * @returns {ContentService.TextOutput} El contenido de la imagen con el MIME type correcto o un error.
 */
function serveImage_(fileId) {

  function isInContentTree_(fileId) {
    const target = CONTENT_FOLDER_ID;
    let queue = (Drive.Files.get(fileId).parents || []).map(p => p.id);
    const seen = new Set(queue);
    while (queue.length) {
      const id = queue.shift();
      if (id === target) return true;
      const parents = (Drive.Files.get(id).parents || []).map(p => p.id);
      for (const p of parents) if (!seen.has(p)) { seen.add(p); queue.push(p); }
    }
    return false;
  }

  try {
    // Seguridad: solo servimos archivos que estén en la carpeta de contenido
    if (!isInContentTree_(fileId)) {
      return ContentService.createTextOutput('Forbidden').setMimeType(ContentService.MimeType.TEXT);
    }

    const f = DriveApp.getFileById(fileId);
    const blob = f.getBlob();                 // respeta el contentType de origen
    // Cachea un poco en el navegador/CDN de Apps Script
    const out = ContentService.createTextOutput(blob.getBytes());
    out.setMimeType(blob.getContentType());
    out.setHeader('Cache-Control', 'public, max-age=600'); // 10 min
    return out;
  } catch (err) {
    return ContentService.createTextOutput('Not Found').setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * Verifica si un archivo está directamente dentro de la carpeta de contenido configurada.
 * @private
 * @param {string} fileId El ID del archivo a verificar.
 * @returns {boolean} True si el archivo es hijo directo de la carpeta de contenido.
 */
function isInContentFolder_(fileId) {
  const folder = DriveApp.getFolderById(CONTENT_FOLDER_ID);
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    if (p.getId() === folder.getId()) return true;
  }
  return false;
}

/**
 * Devuelve la configuración básica de la aplicación para ser usada en el frontend.
 * @returns {{title: string, tz: string}} Un objeto con el título y la zona horaria del script.
 */
function getScriptConfig() {
  return { title: APP_TITLE, tz: Session.getScriptTimeZone() };
}

/**
 * Obtiene el índice de todos los artículos, ordenados por fecha de actualización descendente.
 * Utiliza caché para mejorar el rendimiento.
 * @returns {Array<{slug: string, title: string, updated: string}>} Una lista de artículos.
 */
function getIndex() {
  const cache = CacheService.getScriptCache();
  const key = CACHE_ID;
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const items = listArticles_()
    .map(f => ({ slug: f.slug, title: f.title, updated: f.updated.toISOString() }))
    .sort((a, b) => new Date(b.updated) - new Date(a.updated)); // recientes primero

  cache.put(key, JSON.stringify(items), CACHE_TTL_SECONDS);
  return items;
}

/**
 * Genera una nube de palabras a partir del contenido de todos los artículos.
 * Procesa los archivos de texto, elimina el formato Markdown, filtra palabras comunes (stopwords)
 * y devuelve las más frecuentes. El resultado se almacena en caché.
 * @returns {{words: Array<{word: string, count: number}>, totalDocs: number}} Objeto con las palabras y el total de documentos procesados.
 */
function getWordCloud() {
  try {
    const index = getIndex() || [];
    Logger.log('[CLOUD] index=%s', index.length);

    const stop = new Set((
      'de,la,que,el,en,y,a,los,del,se,las,por,un,para,con,no,una,su,al,lo,como,' +
      'mas,o,pero,sus,le,ya,si,porque,cuando,muy,sin,sobre,tambien,me,hasta,' +
      'hay,donde,quien,desde,todo,nos,durante,uno,les,ni,contra,otros,ese,' +
      'eso,ante,ellos,e,esto,mi,antes,algunos,que,unos,yo,otro,otras,otra,' +
      'el,tanto,esa,estos,mucho,quienes,nada,muchos,cual,poco,ella,estar,' +
      'estas,algunas,algo,nosotros,vos,ustedes,siempre,nunca,ser,es,son,soy,' +
      'eres,somos,fue,era,esta,estan,estoy,estaba,este,esta,estos,estas'
    ).split(',').map(x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));

    const freq = new Map();
    let totalDocs = 0;

    for (const it of index) {
      const slug = it && it.slug;
      if (!slug) continue;

      const page = getPage(slug);
      const md = (page && page.md) || '';
      if (!md.trim()) { Logger.log('[CLOUD] %s: vacío', slug); continue; }

      totalDocs++;

      const cleaned = String(md)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<code[\s\S]*?<\/code>/gi, ' ')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ');

      for (const tok of cleaned.split(/\s+/)) {
        if (!tok || tok.length < 3) continue;
        if (/^\d+$/.test(tok)) continue;
        if (stop.has(tok)) continue;
        freq.set(tok, (freq.get(tok) || 0) + 1);
      }

      Logger.log('[CLOUD] %s: ok', slug);
    }

    const words = [...freq.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

    Logger.log('[CLOUD] ok totalDocs=%s words=%s top=%s',
      totalDocs, words.length,
      words.slice(0, 5).map(w => w.word + ':' + w.count).join(', '));

    return { words, totalDocs };
  } catch (err) {
    Logger.log('[CLOUD] getWordCloud() exception: %s', err);
    throw err;
  }
}

/**
 * Determina de forma heurística si un Blob parece ser un archivo binario.
 * Analiza una muestra de bytes y lo considera binario si hay una alta proporción de caracteres no imprimibles.
 * @private
 * @param {GoogleAppsScript.Base.Blob} blob El blob a inspeccionar.
 * @returns {boolean} True si el blob parece binario.
 */
function blobLooksBinary_(blob) {
  try {
    const b = blob.getBytes();
    if (!b || !b.length) return false;
    const n = Math.min(b.length, 4096);
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const x = b[i] & 0xff;
      // permitir \t(9), \n(10), \r(13)
      if (x === 9 || x === 10 || x === 13) continue;
      // “texto imprimible” aprox. 32..126 y >160 (acentos)
      const printable = (x >= 32 && x <= 126) || x >= 160;
      if (!printable) bad++;
    }
    return bad / n > 0.15; // más de 15% no imprimible → binario
  } catch (e) {
    return false;
  }
}

/**
 * Limpia una cadena de Markdown para dejar solo el texto plano.
 * Elimina bloques de código, enlaces, imágenes, etiquetas HTML y otros elementos de formato.
 * @private
 * @param {string} s La cadena de texto en formato Markdown.
 * @returns {string} El texto plano extraído.
 */
function stripMarkdownToPlain_(s) {
  let t = String(s || '');

  // bloques triple backtick (incl. ```meta … ```)
  t = t.replace(/```[\s\S]*?```/g, ' ');
  // inline code `code`
  t = t.replace(/`[^`]+`/g, ' ');
  // imágenes ![alt](url)
  t = t.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  // links [text](url) → text
  t = t.replace(/\[([^\]]+)]\((?:[^)]+)\)/g, '$1');
  // etiquetas HTML
  t = t.replace(/<\/?[^>]+>/g, ' ');
  // cabeceras/listas/citas al inicio de línea
  t = t.replace(/^[#>\-\*\s]+/gm, ' ');
  // normaliza espacios
  t = t.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ');
  return t;
}

/**
 * Procesa un texto plano, lo tokeniza, filtra stopwords y actualiza un mapa de frecuencias de palabras.
 * Modifica el mapa 'freq' por referencia.
 * @private
 * @param {string} text El texto plano a procesar.
 * @param {Map<string, number>} freq El mapa donde se acumularán las frecuencias.
 * @returns {void}
 */
function countWords_(text, freq) {
  const STOP = new Set([
    // ES
    'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más',
    'pero', 'sus', 'le', 'ya', 'o', 'este', 'sí', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'también', 'me', 'hasta', 'hay',
    'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'e',
    'esto', 'mí', 'antes', 'algunos', 'qué', 'unos', 'yo', 'otro', 'otras', 'otra', 'él', 'tanto', 'esa', 'estos', 'mucho', 'quienes', 'nada',
    'muchos', 'cual', 'poco', 'ella', 'estar', 'estas', 'algunas', 'algo', 'nosotros', 'mi', 'mis', 'tú', 'te', 'ti', 'tu', 'tus', 'ellas',
    'nosotras', 'vosotros', 'vosotras', 'os', 'mío', 'mía', 'míos', 'mías', 'tuyo', 'tuya', 'tuyos', 'tuyas', 'suyo', 'suya', 'suyos', 'suyas',
    'nuestro', 'nuestra', 'nuestros', 'nuestras', 'vuestro', 'vuestra', 'vuestros', 'vuestras', 'esos', 'esas', 'cada', 'sino',
    // EN
    'the', 'and', 'of', 'to', 'in', 'for', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'be', 'this', 'that', 'it', 'an', 'or', 'if', 'not',
    // jerga PDF / PostScript
    'pdf', 'obj', 'endobj', 'xref', 'startxref', 'trailer', 'stream', 'endstream', 'font', 'basefont', 'fontbbox', 'tounicode',
    'cidtogidmap', 'fontdescriptor', 'charprocs', 'widths', 'firstchar', 'lastchar', 'encoding', 'type', 'identity', 'structparent',
    'annot', 'rect', 'parent', 'dest'
  ]);

  const norm = text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // separa por no-letras (permito números en split pero luego filtro)
  const tokens = norm.split(/[^a-z0-9ñ]+/i).filter(Boolean);

  tokens.forEach(w => {
    if (w.length < 3) return;
    if (/[0-9]/.test(w)) return;             // descarta tokens con dígitos (ej. a3p, v97sx5…)
    if (STOP.has(w)) return;
    freq.set(w, (freq.get(w) || 0) + 1);
  });
}

/**
 * Limpia las cachés del script para el índice de artículos y la nube de palabras.
 * @returns {void}
 */
function clearCache() {
  const c = CacheService.getScriptCache();
  c.remove('INDEX_V1');
  c.remove('CLOUD_V2'); // ← añade esta línea
}

/**
 * Obtiene el contenido de una página específica a partir de su 'slug'.
 * Identifica si es un documento de Google, un PDF o un archivo Markdown
 * y devuelve el contenido en el formato adecuado.
 * @param {string} slug El identificador URL-friendly del artículo.
 * @returns {object} Un objeto con los detalles y el contenido de la página.
 */
function getPage(slug) {
  if (!slug) throw new Error('Falta el slug');
  const files = listArticles_();
  const match = files.find(f => f.slug === slug);
  if (!match) return { notFound: true };

  const meta = getFileMeta_(match.id); // ← NUEVO (trae nombre, foto, fecha)

  const file = DriveApp.getFileById(match.id);
  const mime = file.getMimeType();
  const blob = file.getBlob();

  if (mime === MimeType.GOOGLE_DOCS || mime === 'application/vnd.google-apps.document') {
    const md = readGoogleDocAsMarkdown_(file.getId());
    return {
      kind: 'md', slug: match.slug, title: match.title, md,
      updated: match.updated.toISOString(), ...meta
    };
  }

  if (mime === MimeType.PDF || blobIsPdf_(blob)) {
    return {
      kind: 'pdf', slug: match.slug, title: match.title,
      updated: match.updated.toISOString(), pdfBase64: Utilities.base64Encode(blob.getBytes()), ...meta
    };
  }

  const md = blob.getDataAsString('utf-8');
  return {
    kind: 'md', slug: match.slug, title: match.title, md,
    updated: match.updated.toISOString(), ...meta
  };
}

// ============ PRIVADO =========
/**
 * Obtiene el objeto Folder de la carpeta de contenido principal.
 * @private
 * @returns {GoogleAppsScript.Drive.Folder} El objeto de la carpeta de contenido.
 */
function contentFolder_() {
  if (!CONTENT_FOLDER_ID) throw new Error('Define CONTENT_FOLDER_ID');
  return DriveApp.getFolderById(CONTENT_FOLDER_ID);
}

function pingDriveAdvanced_() {
  try {
    // Si esto falla, el servicio avanzado no está habilitado o falta Drive API en Cloud.
    const about = Drive.About.get({ fields: 'user/displayName' });
    Logger.log('[PING] Drive avanzado OK. user=%s',
      about && about.user && about.user.displayName);
  } catch (e) {
    Logger.log('[PING] Drive avanzado FAIL: %s', e);
  }
}

/**
 * Devuelve la fecha de última modificación (ISO) y el último usuario que modificó el archivo.
 * Usa el servicio avanzado de Drive (ya lo estás usando en serveImage_).
 */
/**
 * Devuelve {updatedISO, updatedBy, updatedBySource} con logs detallados.
 * Requiere Drive avanzado habilitado.
 */
/**
 * Devuelve { updatedISO, updatedBy, updatedBySource }
 * - Intenta Drive v3
 * - Fallback a Drive v2
 * - Fallback final a DriveApp
 */
function getFileMeta_(fileId) {
  function fb() {
    const f = DriveApp.getFileById(fileId);
    return {
      updatedISO: f.getLastUpdated().toISOString(),
      updatedBy: '',
      updatedByPhoto: '',
      updatedBySource: 'driveapp'
    };
  }

  if (typeof Drive === 'undefined' || !Drive.Files) return fb();

  // ---- v3
  try {
    const fieldsV3 = 'id,modifiedTime,lastModifyingUser(displayName,photoLink),owners(displayName,photoLink,emailAddress)';
    const f = Drive.Files.get(fileId, { fields: fieldsV3 });

    let updatedISO = f.modifiedTime || fb().updatedISO;
    let updatedBy = (f.lastModifyingUser && f.lastModifyingUser.displayName) || '';
    let updatedByPhoto = (f.lastModifyingUser && f.lastModifyingUser.photoLink) || '';
    let src = 'files.get(v3)';

    if (!updatedBy) {
      const rev = Drive.Revisions.list(fileId, {
        fields: 'revisions(modifiedTime,lastModifyingUser(displayName,photoLink))'
      });
      const arr = rev.revisions || [];
      if (arr.length) {
        const last = arr[arr.length - 1];
        updatedBy = (last.lastModifyingUser && last.lastModifyingUser.displayName) || '';
        updatedByPhoto = (last.lastModifyingUser && last.lastModifyingUser.photoLink) || updatedByPhoto;
        if (!updatedISO && last.modifiedTime) updatedISO = last.modifiedTime;
        src = 'revisions(v3)';
      }
    }

    if (!updatedBy && f.owners && f.owners.length) {
      updatedBy = f.owners[0].displayName || f.owners[0].emailAddress || '';
      updatedByPhoto = f.owners[0].photoLink || '';
      src = 'owner-fallback(v3)';
    }

    return { updatedISO, updatedBy, updatedByPhoto, updatedBySource: src };

  } catch (e1) {
    // ---- v2
    try {
      const fieldsV2 = 'id,modifiedDate,lastModifyingUserName,lastModifyingUser(displayName,picture),owners(displayName,emailAddress,picture)';
      const f = Drive.Files.get(fileId, { fields: fieldsV2 });

      let updatedISO = f.modifiedDate || fb().updatedISO;
      let updatedBy =
        (f.lastModifyingUser && f.lastModifyingUser.displayName) ||
        f.lastModifyingUserName || '';
      let updatedByPhoto =
        (f.lastModifyingUser && f.lastModifyingUser.picture && f.lastModifyingUser.picture.url) || '';
      let src = 'files.get(v2)';

      if (!updatedBy) {
        const rev = Drive.Revisions.list(fileId, {
          fields: 'items(modifiedDate,lastModifyingUser(displayName,picture))'
        });
        const items = rev.items || [];
        if (items.length) {
          const last = items[items.length - 1];
          updatedBy = (last.lastModifyingUser && last.lastModifyingUser.displayName) || '';
          if (!updatedByPhoto && last.lastModifyingUser && last.lastModifyingUser.picture)
            updatedByPhoto = last.lastModifyingUser.picture.url || '';
          if (!updatedISO && last.modifiedDate) updatedISO = last.modifiedDate;
          src = 'revisions(v2)';
        }
      }

      if (!updatedByPhoto && f.owners && f.owners.length && f.owners[0].picture)
        updatedByPhoto = f.owners[0].picture.url || '';

      if (!updatedBy) {
        const owner = DriveApp.getFileById(fileId).getOwner();
        updatedBy = owner ? (owner.getName() || owner.getEmail()) : '';
        src = 'owner-fallback(v2)';
      }

      return { updatedISO, updatedBy, updatedByPhoto, updatedBySource: src };

    } catch (e2) {
      const b = fb();
      b.updatedBySource = 'error: ' + (e1 && e1.message) + ' | ' + (e2 && e2.message);
      return b;
    }
  }
}

/**
 * Enumera todos los archivos de la carpeta de contenido que son considerados artículos (terminan en .md).
 * Genera un 'slug' y un título para cada uno.
 * @private
 * @returns {Array<{id: string, slug: string, title: string, updated: Date}>} Lista de metadatos de los artículos.
 */
function listArticles_() {
  const folder = contentFolder_();
  const it = folder.getFiles();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    const name = f.getName();
    // acepta .md planos y también Google Docs llamados "*.md"
    if (!/\.md$/i.test(name)) continue;
    const base = name.replace(/\.[^/.]+$/, '');
    const slug = slugify_(base);
    const title = prettifyTitle_(base);
    out.push({ id: f.getId(), slug, title, updated: f.getLastUpdated() });
  }
  return out;
}

/**
 * Convierte un nombre de archivo (slug-like) en un título legible y capitalizado.
 * Reemplaza guiones y guiones bajos por espacios y pone en mayúscula la primera letra de cada palabra.
 * @private
 * @param {string} s El nombre base del archivo.
 * @returns {string} El título formateado.
 */
function prettifyTitle_(s) {
  const clean = s.replace(/[-_]+/g, ' ').trim();
  return clean.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1));
}

/**
 * Convierte una cadena de texto en un 'slug' URL-amigable.
 * Elimina acentos, convierte a minúsculas, reemplaza espacios por guiones y elimina caracteres no válidos.
 * @private
 * @param {string} s La cadena a convertir.
 * @returns {string} El slug resultante.
 */
function slugify_(s) {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$|\.+$/g, '');
}

/**
 * Convierte el contenido de un Google Doc a formato Markdown.
 * Itera sobre los elementos del documento (párrafos, listas, tablas, etc.)
 * y los transforma en su sintaxis Markdown equivalente. Incluye lógica para detectar
 * bloques de código basados en la fuente monoespaciada.
 * @private
 * @param {string} docId El ID del Google Doc a procesar.
 * @returns {string} El contenido del documento en formato Markdown.
 */
function readGoogleDocAsMarkdown_(docId) {
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const out = [];
  let inFence = false, codeBuf = [];

  const flushCode = () => {
    if (!codeBuf.length) return;
    out.push('```');
    out.push(codeBuf.join('\n'));
    out.push('```', '');
    codeBuf = []; inFence = false;
  };

  const isMonoParagraph = p => {
    const t = p.editAsText();
    const idx = t.getTextAttributeIndices();
    let mono = 0, total = 0;
    for (let i = 0; i < idx.length; i++) {
      const start = idx[i];
      const end = i + 1 < idx.length ? idx[i + 1] - 1 : t.getText().length - 1;
      const fam = t.getFontFamily(start);
      const len = Math.max(0, end - start + 1);
      total += len;
      if (fam && /courier|consolas|mono/i.test(fam)) mono += len;
    }
    return total > 0 && mono / total > 0.7;
  };

  const HMAP = { HEADING1: '#', HEADING2: '##', HEADING3: '###', HEADING4: '####', HEADING5: '#####', HEADING6: '######' };

  const rows = body.getNumChildren();
  for (let i = 0; i < rows; i++) {
    const el = body.getChild(i);
    const type = el.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      const p = el.asParagraph();
      const text = p.getText().replace(/\r\n?/g, '\n');

      if (/^\s*```/.test(text)) { flushCode(); out.push(text); inFence = !inFence; continue; }
      if (inFence) { codeBuf.push(text); continue; }
      if (isMonoParagraph(p)) { codeBuf.push(text); inFence = true; continue; }

      const h = p.getHeading();
      if (h && HMAP[h.name()]) { flushCode(); out.push(`${HMAP[h.name()]} ${text}`, ''); continue; }

      if (text.trim() === '') { flushCode(); out.push(''); }
      else { flushCode(); out.push(text, ''); }
    }

    else if (type === DocumentApp.ElementType.LIST_ITEM) {
      flushCode();
      const li = el.asListItem();
      const t = li.getText().replace(/\r\n?/g, '\n');
      const indent = '  '.repeat(li.getNestingLevel());
      const glyph = li.getGlyphType ? String(li.getGlyphType()) : '';
      const ordered = /NUMBER|DIGIT|LATIN|ROMAN/i.test(glyph);
      out.push(`${indent}${ordered ? '1.' : '-'} ${t}`);
    }

    else if (type === DocumentApp.ElementType.TABLE) {
      flushCode();
      const tbl = el.asTable();
      for (let r = 0; r < tbl.getNumRows(); r++) {
        const row = [];
        for (let c = 0; c < tbl.getRow(r).getNumCells(); c++) {
          row.push(tbl.getRow(r).getCell(c).getText().replace(/\n/g, ' '));
        }
        if (r === 0) {
          out.push(`| ${row.join(' | ')} |`);
          out.push(`| ${row.map(() => '---').join(' | ')} |`);
        } else {
          out.push(`| ${row.join(' | ')} |`);
        }
      }
      out.push('');
    }
  }
  flushCode();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Detecta si un Blob corresponde a un archivo PDF revisando su cabecera ('magic number' %PDF-).
 * @private
 * @param {GoogleAppsScript.Base.Blob} blob El blob a inspeccionar.
 * @returns {boolean} True si el blob es un PDF.
 */
function blobIsPdf_(blob) {
  try {
    const b = blob.getBytes();
    return b && b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  } catch (e) {
    return false;
  }
}
