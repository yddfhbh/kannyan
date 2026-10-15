// One injected instant is shared by the deterministic answer and model context.
export function getChatClock(now = new Date(), timeZone = 'Asia/Seoul') {
  const instant = new Date(now);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Intl.DateTimeFormat('ko-KR', { timeZone, weekday: 'long' }).format(instant);
  return { date, weekday, time: `${parts.hour}:${parts.minute}:${parts.second}`, timeZone, utc: instant.toISOString() };
}

export function resolveChatTimeZone(prompt) {
  const text = String(prompt ?? '');
  const iana = text.match(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/);
  if (iana) {
    try { getChatClock(new Date(0), iana[0]); return iana[0]; } catch { return null; }
  }
  const zones = [
    [/뉴욕|new york|미국\s*동부|\bEST\b|\bEDT\b/i, 'America/New_York'],
    [/로스앤젤레스|로스엔젤레스|LA\s*(?:기준|시간)|미국\s*서부|\bPST\b|\bPDT\b/i, 'America/Los_Angeles'],
    [/런던|london|영국/i, 'Europe/London'], [/파리|프랑스|paris/i, 'Europe/Paris'],
    [/베이징|중국|beijing/i, 'Asia/Shanghai'], [/시드니|sydney/i, 'Australia/Sydney'], [/도쿄|일본|tokyo|\bJST\b/i, 'Asia/Tokyo'],
    [/\bUTC\b|\bGMT\b/i, 'UTC'], [/한국|서울|\bKST\b/i, 'Asia/Seoul'],
  ];
  for (const [pattern, zone] of zones) if (pattern.test(text)) return zone;
  // Do not silently report KST for an unrecognized requested region.
  if (/(?:기준|현지|시간대)/.test(text) && !/(?:오늘|현재|지금)\s*기준/.test(text)) return null;
  return 'Asia/Seoul';
}

export function answerClockQuestion(prompt, now = new Date()) {
  const text = String(prompt ?? '').trim();
  if (!/(?:오늘|현재|지금|today|current).*(?:날짜|며칠|몇\s*일|요일|시각|시간|몇\s*시|date|time)|^(?:날짜|며칠|몇\s*시)(?:야|니|인가|알려줘|\?)?$/i.test(text)) return '';
  // A date in an event, price, document or image request is not a clock query.
  if (/날씨|가격|일정|뉴스|출시|생일|나이|이미지|사진|번역|요약|계산|회의|경기|환율|주가/.test(text)) return '';
  const remainder = text.replace(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/g, '')
    .replace(/오늘|현재|지금|날짜|며칠|몇\s*일|요일|시각|시간대|시간|몇\s*시|검색해서|검색해|검색|알아와|알려\s*줘|찾아\s*줘|해\s*줘|기준|현지|한국|서울|뉴욕|미국|동부|서부|일본|도쿄|런던|영국|파리|프랑스|베이징|중국|시드니|로스앤젤레스|로스엔젤레스|좀|뭐야|뭔지|뭐니|인지|이야|인가요|인가|나요|야|니|는|은|의|가|이|를|을|도|에|\b(?:KST|UTC|GMT|EST|EDT|PST|PDT|JST|LA|today|current|date|time|search|please)\b|[\s?!.,~]/gi, '');
  if (remainder) return '';
  const timeZone = resolveChatTimeZone(text);
  if (!timeZone) return '시간대를 확인하지 못했다냥. Asia/Seoul 같은 시간대 이름을 알려달라냥.';
  const clock = getChatClock(now, timeZone);
  return `${clock.timeZone} 기준 ${clock.date} ${clock.weekday}${/시각|시간|몇\s*시|time/i.test(text) ? ` ${clock.time}` : ''}이다냥. (서버 시계 기준)`;
}

export function calculateAge(birthDate, referenceDate) {
  const parse = (value) => {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const [year, month, day] = m.slice(1).map(Number);
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? [year, month, day] : null;
  };
  const b = parse(birthDate), r = parse(referenceDate);
  if (!b || !r || birthDate > referenceDate) return null;
  return r[0] - b[0] - (r[1] < b[1] || (r[1] === b[1] && r[2] < b[2]) ? 1 : 0);
}

export function getAgeReferenceDate(prompt, now = new Date()) {
  const match = String(prompt).match(/(\d{4})[년./-]\s*(\d{1,2})[월./-]\s*(\d{1,2})일?\s*기준/);
  if (match) {
    const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    return calculateAge('0001-01-01', date) === null ? null : date;
  }
  const zone = resolveChatTimeZone(prompt);
  return zone ? getChatClock(now, zone).date : null;
}
