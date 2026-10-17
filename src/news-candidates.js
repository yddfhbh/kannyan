// Discovery metadata only: these dates never establish verified publication.
export function rankNewsCandidates(items, now = Date.now()) {
  const reference = new Date(now).getTime();
  return items.map((candidate, index) => {
    let reason = '', url;
    try { url = new URL(candidate.url); } catch { reason = 'invalid-url'; }
    if (url && (!['http:', 'https:'].includes(url.protocol)
        || !url.pathname.split('/').filter(Boolean).length
        || /\/(?:tags?|category|categories|topics?|search|boards?|newsroom|archives?|list)(?:\/|$)/i.test(url.pathname)
        || /\/(?:news|press|blog|index\.(?:html?|php))\/?$/i.test(url.pathname))) reason = 'listing-or-homepage';
    const metadata = [candidate.publishedAt, candidate.title, url?.pathname,
      // A date buried in a snippet may describe an older event in a new story.
      String(candidate.snippet || '').match(/^\s*(20\d{2}[-./]\s*\d{1,2}[-./]\s*\d{1,2})/)?.[1]].filter(Boolean).join(' ');
    const match = metadata.match(/\b(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/);
    const dateHint = match ? `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}` : '';
    const age = reference - new Date(dateHint).getTime();
    if (!reason && Object.hasOwn(candidate, 'publishedAt') && !candidate.publishedAt) reason = 'missing-publication-date';
    if (!reason && dateHint && (!Number.isFinite(age) || age < -86400000 || age > 14 * 86400000)) reason = 'stale-or-future-discovery-date';
    const articleShape = /article|stories|story|newsview|\/20\d{2}\/|[?&](?:id|idxno|ncode)=/i.test(candidate.url || '');
    return { candidate, index, eligible: !reason, dateHint, score: (dateHint ? 10 : 0) + (articleShape ? 3 : 0),
      reason: reason || (dateHint ? 'dated-article-candidate' : 'publication-date-needs-verification') };
  }).sort((a,b) => Number(b.eligible)-Number(a.eligible) || b.score-a.score || a.index-b.index);
}
