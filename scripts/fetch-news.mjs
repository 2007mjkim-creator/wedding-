// ====================================================
// 실시간 웨딩 소식 수집 스크립트 (GitHub Actions에서 3시간마다 실행)
// - 네이버 뉴스 검색 API(NAVER API HUB)로 스드메·웨딩 관련 최신 기사를 모아 data/news.json 생성
// - 저작권: 제목·요약·원문 링크만 저장하고 기사 본문·사진은 저장하지 않음
// - 키는 GitHub 저장소 Secrets(NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)에서만 읽음
//   (네이버 클라우드 NAVER API HUB에서 '뉴스' API로 등록한 Application의 인증 정보)
// - 수동 실행: GitHub 저장소 → Actions → '실시간 웨딩 소식 업데이트' → Run workflow
// ====================================================
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ID = (process.env.NAVER_CLIENT_ID || '').trim();       // 복사할 때 섞인 공백·줄바꿈 제거
const SECRET = (process.env.NAVER_CLIENT_SECRET || '').trim();
if (!ID || !SECRET) {
  console.log('::error::NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 가 설정되지 않았습니다. (GitHub → Settings → Secrets and variables → Actions)');
  process.exit(1);
}

const OUT = 'data/news.json';

// 분야별 검색어 (앞에 있는 분야가 우선 — 같은 기사가 여러 분야에 걸리면 앞 분야로 분류)
const CATEGORIES = [
  { key: 'dress',  queries: ['웨딩드레스', '드레스 투어'] },
  { key: 'studio', queries: ['웨딩스튜디오', '웨딩 촬영'] },
  { key: 'makeup', queries: ['웨딩 메이크업', '신부 메이크업'] },
  { key: 'hall',   queries: ['웨딩홀', '예식장 식대'] },
  { key: 'prep',   queries: ['스드메', '결혼 준비 비용', '웨딩박람회', '웨딩 트렌드'] }
];
const PER_QUERY = 40;     // 검색어당 가져올 기사 수 (최대 100)
const PER_CATEGORY = 12;  // 분야별로 보여줄 최대 기사 수
const MAX_AGE_DAYS = 45;  // 너무 오래된 기사는 제외

// 제목에 결혼 준비 관련 단어가 있어야 통과 (요약에만 '웨딩홀에서 열린 행사' 식으로 나오는 기사, 연예인 혼인 소식 등 제외)
const TITLE_MUST_HAVE = /웨딩|예식|스드메|신부|신랑|결혼식|결혼s?준비|결혼s?업체|결혼업체|결혼s?비용|결혼s?시장|혼수|예비부부|부케|청첩장|허니문|신혼여행|본식|브라이덜/;   // '드레스'·'메이크업' 단독은 패션 기사가 많아 제외 (웨딩드레스·신부 메이크업은 '웨딩'·'신부'로 통과)
// 불미스러운 사건·사고 기사, 행사 장소로만 언급된 기사 제외
const EXCLUDE = /부고|별세|사망|숨져|숨진|화재|살인|폭행|성범죄|마약|음주운전|혐의|구속|기소|사기|피의자/;
const VENUE_ONLY = /(웨딩홀|예식장|컨벤션)에서\s?(열린|개최|진행된|열려)/;
// 연예·가십성 제목 제외
const GOSSIP = /♥|★|나솔|나는\s?솔로|열애|결혼\s?발표|결혼\s?소식|결혼\s?임박|결혼\s?앞두고|득녀|득남|임신|아이돌|열애설|스캔들|자태|아내|남편|예비\s?신부와|신랑수업|혼전순결|현커|조폭|촬영장|\[[^\]]*(라스|해시태그|종합|인터뷰)/;

// 같은 사건을 여러 언론사가 쓴 기사 묶기: 제목 단어가 많이 겹치면 같은 기사로 보고 최신 1건만 남김
const STOP = new Set(['위해', '관련', '통해', '대한', '등', '및', '첫', '한', '것', '수', '더', '중', '오늘', '올해', '개최', '진행', '운영']);
const words = (t) => new Set(
  t.replace(/(\d+)\s?(곳|개|건|명|만원|원)/g, '$1')       // '17곳'·'17개' 같은 표현을 같은 단어로
   .replace(/[^가-힣A-Za-z0-9~]+/g, ' ')
   .split(' ').filter(w => w.length >= 2 && !STOP.has(w)));
const keptWordSets = [];
function isSameStory(title) {
  const a = words(title);
  if (a.size === 0) return false;
  return keptWordSets.some(b => {
    let common = 0;
    a.forEach(w => { if (b.has(w)) common++; });
    const ratio = common / Math.min(a.size, b.size);
    // 같은 숫자(예: 17곳 → 17)와 다른 단어가 함께 겹치면 같은 사건 (연도·날짜처럼 흔한 숫자는 제외)
    const sharedNumber = [...a].some(w => /^\d{2,3}$/.test(w) && b.has(w));
    return (common >= 2 && ratio >= 0.4) || (common >= 3 && ratio >= 0.3) || (sharedNumber && common >= 2);
  });
}

// 분야는 제목 단어로 결정 (검색어는 기사를 찾는 용도로만 사용)
function categoryOf(title, fallback) {
  if (/드레스|턱시도|예복/.test(title)) return 'dress';
  if (/스튜디오|촬영|스냅|화보/.test(title)) return 'studio';
  if (/메이크업|헤어|뷰티|네일/.test(title)) return 'makeup';
  if (/웨딩홀|예식장|식대|결혼식장|컨벤션|하객|축의금/.test(title)) return 'hall';
  if (/스드메|박람회|비용|준비|혼수|예비부부|허니문|신혼여행|청첩장|트렌드/.test(title)) return 'prep';
  return fallback;
}

// 주요 언론사 도메인 → 이름 (없으면 도메인 그대로 표시)
const SOURCES = {
  'hankyung.com': '한국경제', 'mk.co.kr': '매일경제', 'chosun.com': '조선일보', 'biz.chosun.com': '조선비즈',
  'donga.com': '동아일보', 'joongang.co.kr': '중앙일보', 'hani.co.kr': '한겨레', 'khan.co.kr': '경향신문',
  'yna.co.kr': '연합뉴스', 'newsis.com': '뉴시스', 'news1.kr': '뉴스1', 'edaily.co.kr': '이데일리',
  'mt.co.kr': '머니투데이', 'sedaily.com': '서울경제', 'heraldcorp.com': '헤럴드경제', 'asiae.co.kr': '아시아경제',
  'fnnews.com': '파이낸셜뉴스', 'kmib.co.kr': '국민일보', 'segye.com': '세계일보', 'hankookilbo.com': '한국일보',
  'seoul.co.kr': '서울신문', 'munhwa.com': '문화일보', 'ytn.co.kr': 'YTN', 'sbs.co.kr': 'SBS', 'kbs.co.kr': 'KBS',
  'imbc.com': 'MBC', 'jtbc.co.kr': 'JTBC', 'mbn.co.kr': 'MBN', 'tvchosun.com': 'TV조선', 'ichannela.com': '채널A',
  'nocutnews.co.kr': '노컷뉴스', 'ohmynews.com': '오마이뉴스', 'inews24.com': '아이뉴스24', 'ajunews.com': '아주경제',
  'dt.co.kr': '디지털타임스', 'newspim.com': '뉴스핌', 'etnews.com': '전자신문', 'bizwatch.co.kr': '비즈워치',
  'sportschosun.com': '스포츠조선', 'sports.donga.com': '스포츠동아', 'osen.co.kr': 'OSEN', 'xportsnews.com': '엑스포츠뉴스',
  'newsen.com': '뉴스엔', 'starnewskorea.com': '스타뉴스', 'tenasia.co.kr': '텐아시아', 'fashionbiz.co.kr': '패션비즈',
  'fashionn.com': '패션엔', 'beautynury.com': '뷰티누리', 'cosmorning.com': '코스모닝', 'wkorea.com': 'W코리아',
  'vogue.co.kr': '보그', 'elle.co.kr': '엘르', 'marieclairekorea.com': '마리끌레르', 'harpersbazaar.co.kr': '하퍼스바자',
  'cosmopolitan.co.kr': '코스모폴리탄', 'news.naver.com': '네이버뉴스',
  'stoo.com': '스포츠투데이', 'cstimes.com': '컨슈머타임스', 'korea.kr': '정책브리핑', 'topstarnews.net': '톱스타뉴스',
  'wikitree.co.kr': '위키트리', 'insight.co.kr': '인사이트', 'dailian.co.kr': '데일리안', 'newdaily.co.kr': '뉴데일리',
  'ekn.kr': '에너지경제', 'mediapen.com': '미디어펜', 'breaknews.com': '브레이크뉴스', 'sisajournal.com': '시사저널',
  'kukinews.com': '쿠키뉴스', 'consumernews.co.kr': '소비자가만드는신문', 'sportsseoul.com': '스포츠서울',
  'sportsworldi.com': '스포츠월드', 'mydaily.co.kr': '마이데일리', 'joynews24.com': '조이뉴스24', 'dispatch.co.kr': '디스패치',
  'gukjenews.com': '국제뉴스', 'newsway.co.kr': '뉴스웨이', 'thebell.co.kr': '더벨', 'hankooki.com': '데일리한국',
  'womaneconomy.co.kr': '여성경제신문', 'ksilbo.co.kr': '경상일보', 'busan.com': '부산일보', 'kookje.co.kr': '국제신문',
  'imaeil.com': '매일신문', 'yeongnam.com': '영남일보', 'kwnews.co.kr': '강원일보', 'jjan.kr': '전북일보', 'kyeonggi.com': '경기일보'
};

const decode = (s) => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

function sourceOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|news|biz|sports|stoo|view)\./, '');
    const full = new URL(url).hostname.replace(/^www\./, '');
    const hit = Object.keys(SOURCES).find(d => full === d || full.endsWith('.' + d)) ||
                Object.keys(SOURCES).find(d => host === d || host.endsWith('.' + d));
    return hit ? SOURCES[hit] : host;
  } catch { return ''; }
}

// NAVER API HUB(네이버 클라우드) 뉴스 검색 — 기존 개발자센터 검색 API는 신규 등록이 중단되어 이관
async function search(query) {
  const url = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(query)}&display=${PER_QUERY}&sort=date`;
  const res = await fetch(url, { headers: { 'X-NCP-APIGW-API-KEY-ID': ID, 'X-NCP-APIGW-API-KEY': SECRET } });
  if (!res.ok) throw new Error(`'${query}' 검색 실패: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).items || [];
}

const seenUrl = new Set();
const seenTitle = new Set();
const normTitle = (t) => t.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 40);
const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;

let failures = 0;
let calls = 0;

// 1) 모든 검색어 결과를 한데 모음
const candidates = [];
for (const cat of CATEGORIES) {
  for (const q of cat.queries) {
    calls++;
    let found;
    try { found = await search(q); } catch (err) { failures++; console.log('::warning::' + err.message.replace(/\s+/g, ' ')); continue; }
    for (const it of found) {
      const title = decode(it.title);
      const desc = decode(it.description);
      const url = it.originallink || it.link;
      const time = Date.parse(it.pubDate);
      if (!title || !url || !time || time < cutoff) continue;
      const text = title + ' ' + desc;
      if (!TITLE_MUST_HAVE.test(title) || EXCLUDE.test(text) || VENUE_ONLY.test(text) || GOSSIP.test(title)) continue;
      candidates.push({ fallback: cat.key, title, desc, url, time });
    }
  }
}

// 2) 최신순으로 보면서 같은 기사·같은 사건은 1건만 남기고, 제목으로 분야 결정
candidates.sort((a, b) => b.time - a.time);
const perCat = {};
const items = [];
for (const c of candidates) {
  const key = normTitle(c.title);
  if (seenUrl.has(c.url) || seenTitle.has(key) || isSameStory(c.title)) continue;
  seenUrl.add(c.url); seenTitle.add(key); keptWordSets.push(words(c.title));
  const cat = categoryOf(c.title, c.fallback);
  perCat[cat] = (perCat[cat] || 0) + 1;
  if (perCat[cat] > PER_CATEGORY) continue;
  items.push({ cat, title: c.title, desc: c.desc.slice(0, 160), url: c.url, source: sourceOf(c.url), date: new Date(c.time).toISOString() });
}

if (failures === calls) {
  console.log('::error::모든 검색이 실패했습니다. NAVER API HUB Application의 Client ID/Secret과 선택한 API(뉴스)를 확인하세요.');
  process.exit(1);
}

items.sort((a, b) => b.date.localeCompare(a.date));

// 기사 목록이 그대로면 파일을 건드리지 않음 (불필요한 커밋 방지)
let previous = null;
try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }
if (previous && JSON.stringify(previous.items) === JSON.stringify(items)) {
  console.log(`변경 없음 (${items.length}건)`);
  process.exit(0);
}

await mkdir('data', { recursive: true });
await writeFile(OUT, JSON.stringify({
  updatedAt: new Date().toISOString(),
  source: '네이버 뉴스 검색',
  items
}, null, 1) + '\n');

const byCat = CATEGORIES.map(c => `${c.key} ${items.filter(i => i.cat === c.key).length}`).join(', ');
console.log(`저장 완료: ${items.length}건 (${byCat})${failures ? ` · 실패한 검색어 ${failures}개` : ''}`);
