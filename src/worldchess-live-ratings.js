import { JSDOM } from 'jsdom';

const sources = Object.freeze({
  classical: 'https://worldchess.com/live-ratings',
  rapid: 'https://worldchess.com/live-ratings/rapid',
  blitz: 'https://worldchess.com/live-ratings/blitz',
});

export function parseWorldChessLiveRatings(html) {
  const document = new JSDOM(html).window.document;
  const rows = [];

  for (const tr of document.querySelectorAll('table tbody tr')) {
    const cells = [...tr.querySelectorAll(':scope > td')];
    if (cells.length < 7) continue;

    const ratingText = cells[cells.length - 1].textContent.replace(/\s/g, '');
    // The last column includes hidden/skeleton numbers before the real value.
    const ratingMatch = ratingText.match(/(\d{4})$/);
    if (!ratingMatch) continue;
    const rating = Number(ratingMatch[1]);
    if (rating < 2200 || rating > 3200) continue;

    const anchors = [...cells[2].querySelectorAll('a')];
    const anchor = anchors.find(a => {
      const name = a.textContent.trim();
      return name.length > 3 && /[a-z]{2}/i.test(name) && !/^\w{3}$/.test(name);
    });
    const cellText = cells[2].textContent.replace(/\s+/g, ' ').trim();
    const fallback = cellText.split(/(?:W?GM|W?IM|W?FM|W?CM)\s*·\s*(?:ID|FIDE)/i)[0].trim();
    const name = (anchor?.textContent || fallback).replace(/\s+/g, ' ').trim();
    if (!name || /\d{5,}/.test(name) || name.length > 65) continue;

    const changeRaw = cells[1].textContent.replace(/\s/g, '');
    const changeVisible = changeRaw.includes('=') ? changeRaw.split('=').at(-1) : changeRaw;
    const changes = [...changeVisible.matchAll(/([▲▼])(\d+(?:\.\d+)?)/g)]
      .filter(m => Number(m[2]) !== 99);
    const last = changes.at(-1);
    const change = last ? (last[1] === '▲' ? '+' : '-') + last[2] : '-';

    rows.push({ rank: rows.length + 1, name, rating, change });
  }

  if (rows.length < 50) {
    throw new Error(`World Chess parser found only ${rows.length} valid rows`);
  }
  if (new Set(rows.map(x => x.name.toLowerCase())).size !== rows.length) {
    throw new Error('World Chess parser found duplicate player names');
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].rating > rows[i - 1].rating) {
      throw new Error(`World Chess ratings not sorted at row ${i + 1}`);
    }
  }
  return rows;
}

export async function fetchWorldChessLiveRatings(type) {
  const url = sources[type];
  if (!url) throw new Error(`Unsupported live rating mode: ${type}`);
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; ChessLiveRating/1.0)' },
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`World Chess HTTP ${response.status} for ${type}`);
  return parseWorldChessLiveRatings(await response.text());
}
