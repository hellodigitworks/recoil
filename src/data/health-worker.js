// The Health import, off the main thread.
//
// Reading a gigabyte of XML takes minutes. On the main thread that is minutes
// of a frozen phone, and iOS eventually decides the tab has hung and reloads
// it, losing the whole import. In here the interface stays live and the
// progress line actually moves.
//
// The File object is passed in whole. It is a handle to bytes on disk, not the
// bytes, so handing it across costs nothing.

import { listEntries, findEntry, entryStream } from './health-zip.js';
import { parseHealthExport } from './health-parse.js';

const EXPORT_NAME = 'export.xml';

self.onmessage = async (event) => {
  const { file } = event.data;
  try {
    const entries = await listEntries(file);
    const entry = findEntry(entries, '/' + EXPORT_NAME) || findEntry(entries, EXPORT_NAME);
    if (!entry) {
      throw new Error('No export.xml inside that zip. Pick the file Health gave you, not one you unzipped.');
    }

    // Progress is measured against the uncompressed size the archive declares,
    // which is what actually gets read. Reporting against the zip's own size
    // would crawl to 12% and stop.
    const total = entry.uncompressedSize || 0;
    let lastSent = 0;
    const result = await parseHealthExport(await entryStream(file, entry), {
      onProgress: (chars) => {
        // Roughly one byte per character: the export is ASCII apart from the
        // odd accented source name. Throttled, or postMessage becomes the
        // expensive part of the import.
        const pct = total ? Math.min(99, Math.floor((chars / total) * 100)) : 0;
        if (pct > lastSent) {
          lastSent = pct;
          self.postMessage({ type: 'progress', pct, chars, total });
        }
      }
    });

    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
  }
};
