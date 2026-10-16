import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReadablePageText } from '../src/web-page-content.js';
import { collectNewsEvidence, answerVerifiedNews } from '../src/news-evidence.js';
import { reviewSourceBodies } from '../src/evidence-review.js';
import { collectWebBodyEvidence, renderWeatherEvidence } from '../src/web-evidence.js';
import { runtime } from '../scripts/lib/chat-verification-runtime.js';
import { parsePyhokWikiSearchResponse } from '../src/pyhok-wiki-search.js';

const now = '2026-10-15T12:00:00Z';
const message = (q) => ({content:`%${q}`,author:{id:'test',username:'test'},guildId:'g',channelId:'c',client:{user:{username:'깐냥'}},attachments:new Map(),channel:{send:async()=>{}}});
// Synthetic reproductions of the reported article subjects, not retrieved originals.
const unrelated = [
  {title:'컬러강판 발포Sol 개발',body:'철강 회사가 컬러강판 제품의 발포 소재 개발 성과를 발표했다. 건축용 강판의 단열 성능과 생산 공정에 관한 소식이다. '},
  {title:'증권사 신용공여',body:'증권사의 신용공여 규모가 증가했다. 투자자의 주식 담보 대출과 신용 거래 잔고 변화에 관한 기사다. '},
  {title:'육군 장교의 노인 구조',body:'육군 장교가 길에 쓰러진 노인을 발견해 구조했다. 현장 응급조치와 병원 이송 경위를 전하는 소식이다. '},
].map((item,id)=>({url:`https://news.test/story-${id}`,articleTitle:item.title,title:item.title,
  text:item.body.repeat(4)+' 추천 기사: AI 모델 공개',publishedAt:'2026-10-14',publicationEvidence:'datePublished',isArticle:true,links:[]}));

test('reported unrelated subjects stay rejected despite fresh dates, full bodies and incidental AI',async()=>{
  const data = await collectNewsEvidence('최신 AI 뉴스',{status:'success',results:unrelated}, {
    now,readPage:async(url)=>unrelated.find(s=>s.url===url),search:async()=>({status:'empty',results:[]}),
    reviewSources:(sources)=>reviewSourceBodies('최신 AI 뉴스',sources,async(prompt,options)=>{
      assert.match(prompt,/주된 내용/);
      assert.match(options.webSearchContext,/컬러강판/);
      return {evidenceReviews:sources.map((_,id)=>({id,relevant:false,quote:'',reason:'핵심은 인공지능이 아닌 다른 사건이다.'}))};
    }),
  });
  assert.equal(data.results.length,0);
  assert.equal(data.status,'no-verified-articles');
  for(const attempt of data.newsVerification.attempts) {
    assert.equal(attempt.bodyValid,true);
    assert.equal(attempt.fresh,true);
    assert.equal(attempt.status,'relevance-rejected');
    assert.equal(attempt.relevance.relevant,false);
  }
});

test('list links are topic-filtered and discovery, final URL, title and body provenance stay connected',async()=>{
  const reads=[];
  const url='https://news.test/newsroom';
  const good={...unrelated[0],url:'https://news.test/new-model',articleTitle:'AI 모델 공개',text:'새 AI 모델의 추론 기능과 학습 방식이 공개되었다. 개발사가 언어 모델 평가 결과와 API 제공 계획을 발표했다. '.repeat(4)};
  const data=await collectNewsEvidence('최신 AI 뉴스',{status:'success',results:[{url,title:'AI 뉴스룸'}]}, {
    now,search:async()=>({status:'empty',results:[]}),readPage:async(u)=>{
      reads.push(u);
      return u===url?{url,links:[...unrelated.map(s=>({url:s.url,title:s.title})),{url:good.url,title:good.articleTitle}]}:good;
    },
  });
  assert.deepEqual(reads,[url,good.url]);
  assert.equal(data.results[0].url,good.url);
  assert.equal(data.newsVerification.attempts[1].parentUrl,url);
  assert.equal(data.newsVerification.attempts[1].extractedTitle,good.articleTitle);
});

test('article body extraction drops navigation and recommendation AI and rejects mismatched canonical identity',async()=>{
  const page=extractReadablePageText(`<title>구조 소식</title><nav>AI</nav><article><h1>노인 구조</h1><div class="article-body">${'장교가 노인을 구조했다. '.repeat(20)}<aside>AI 추천</aside></div><div class="related-news">AI 뉴스</div></article><footer>AI</footer>`);
  assert.doesNotMatch(page.text,/AI/);
  const data=await collectNewsEvidence('AI 뉴스',{status:'success',results:[{url:'https://news.test/a'}]}, {
    now,search:async()=>({status:'empty',results:[]}),readPage:async()=>({...unrelated[0],url:'https://news.test/a',canonicalUrl:'https://news.test/b',articleTitle:'AI',text:'AI 모델 공개 '.repeat(30)}),
  });
  assert.equal(data.results.length,0);
  assert.equal(data.newsVerification.attempts[0].status,'identity-mismatch');
});

test('review needs an unambiguous ID and exact body quotation; final news cannot invent a summary',async()=>{
  const source={url:'https://source.test/a',title:'AI',pageText:'인공지능 언어 모델의 공개 범위와 추론 성능을 설명한다. 평가 조건과 제공 일정은 해당 본문에 한정된다. '.repeat(4)};
  for(const reviews of [[],[{id:0,relevant:true,quote:'본문에 없는 다른 내용'.repeat(8)}],[{id:0,relevant:true,quote:source.pageText.slice(0,100)},{id:0,relevant:true,quote:source.pageText.slice(0,100)}]]) {
    const [reviewed]=await reviewSourceBodies('AI 뉴스',[source],async()=>({evidenceReviews:reviews}));
    assert.equal(reviewed.bodyReview.relevant,false);
  }
  const quote=source.pageText.slice(0,100);
  const [reviewed]=await reviewSourceBodies('AI 뉴스',[source],async()=>({evidenceReviews:[{id:0,relevant:true,quote}]}));
  const final=await answerVerifiedNews({results:[{...reviewed,publishedAt:'2026-10-14'}],newsVerification:{freshnessDays:14}},async(_prompt, options)=>options.evidenceReview ? {evidenceReviews:[{id:0,relevant:false,quote:'',reason:'원문에 없는 주장'}]} : {answer:'모든 AI 서비스의 가격이 내렸다.',citationsValid:true});
  assert.doesNotMatch(final,/모든 AI 서비스|핵심 본문 발췌/);
  assert.match(final,/요약 검증에 실패/);
});

test('YouTube footer and HIX homepage cannot become official comparison evidence; individual subjects get retries',async()=>{
  const queries=[];
  const body='YouTube About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy & Safety. '.repeat(4);
  const data=await collectWebBodyEvidence('gpt 6 sol vs gpt 6.1 sol',{status:'success',results:[{url:'https://youtube.test/watch?v=1',title:'gpt 6 sol vs gpt 6.1 sol'},{url:'https://hix.test/',title:'HIX'}]},async(_prompt,options)=>{
    assert.match(options.webSearchContext,/Copyright/);
    return {evidenceReviews:[{id:0,relevant:false,quote:'',reason:'영상 내용 없음'},{id:1,relevant:false,quote:'',reason:'모델별 공식 설명 없음'}]};
  },{readPage:async(url)=>({url,title:'홈페이지',text:body}),search:async(q)=>{queries.push(q);return {status:'empty',results:[]};}});
  assert.equal(data.status,'insufficient-evidence');
  assert.deepEqual(data.results,[]);
  assert.deepEqual(queries,['"gpt 6 sol" official documentation','"gpt 6.1 sol" official documentation']);
  const page=extractReadablePageText('<title>비교 영상</title><nav>메뉴</nav><footer>'+body+'</footer>');
  assert.equal(page.bodyQuality,'insufficient');
});

test('actual handler replaces the reported contradictory wiki draft with verified facts, including mixed requests',async()=>{
  for(const independent of ['', '너 누구야']) {
    const question=independent?'너 누구야 그리고 푝무위키 파이호크 나이':'푝무위키 파이호크 나이';
    const results=parsePyhokWikiSearchResponse({hits:[{title:'파이호크',raw:'생일2007년 9월 14일',anyoneReadable:true}]},{query:'파이호크'});
    const r=runtime({wiki:{results,status:'success'}});
    const prompts=[];
    r.context.generateGeminiAnswer=async(prompt,options)=>{
      prompts.push({prompt,options});
      return options.planSearch?{answer:'푝무위키와 파이호크에 대한 정보는 확인되지 않는다.',sourcePlan:{mode:'search',query:'파이호크',purpose:'나이 확인',externalPrompt:'파이호크 나이',localPrompt:independent}}:{answer:independent?'나는 깐냥이다냥.':''};
    };
    await r.context.handleGeminiFallbackMessage(message(question));
    assert.equal(r.sent.length,1);
    assert.match(r.sent[0],/2007-09-14/);
    assert.doesNotMatch(r.sent[0],/확인되지 않는다|정보.*없/);
    assert.equal(prompts.length,2);
    if(independent) { assert.equal(prompts[1].prompt,independent); assert.match(r.sent[0],/나는 깐냥/); }
  }
});

test('weather retains actual district, forecast and target time through final handler assembly',async()=>{
  const quote='부산광역시 남구 용당동의 10월 15일 18시 시간별 예보는 기온 20도이며 강수확률 10퍼센트이다. 실제 관측값과는 구분해서 제공한다.';
  const data={status:'success',results:[{url:'https://weather.test/district',title:'용당동',pageText:quote,bodyReview:{region:'부산광역시 남구 용당동',validTime:'10월 15일 18시',kind:'forecast',quote,relevant:true}}],context:quote};
  const r=runtime({search:data,localAnswer:'날씨 정보를 확인하지 못했다냥.',plan:{mode:'search',query:'부산 날씨',purpose:'확인',externalPrompt:'부산 날씨',localPrompt:'너 누구야'}});
  r.context.generateGeminiAnswer=async(prompt,options)=>options.planSearch?{answer:'자기소개와 날씨를 알려주겠다냥.',sourcePlan:{mode:'search',query:'부산 날씨',purpose:'확인',externalPrompt:'부산 날씨',localPrompt:'너 누구야'}}:{answer:'나는 깐냥이다냥.'};
  await r.context.handleGeminiFallbackMessage(message('너 누구고 오늘 부산 날씨는 어때?'));
  assert.equal(r.sent.length,1);
  assert.ok(r.sent[0].includes(renderWeatherEvidence(data)));
  assert.match(r.sent[0],/용당동 · 예보/);
  assert.match(r.sent[0],/자료 대상 시각: 10월 15일 18시/);
  assert.doesNotMatch(r.sent[0],/현재 부산.*20도|확인하지 못/);
});

test('compound wiki facts use a separate supported excerpt and arbitrary identities/dates remain data-driven',async()=>{
  const question='푝무위키 예제인물 나이와 활동';
  const quote='예제인물은 지역 동아리에서 음악 공연을 기획하고 공개 행사를 진행하며, 정기적인 활동 소식을 위키에 기록한다.';
  const results=parsePyhokWikiSearchResponse({hits:[{title:'예제인물',raw:`생일1994년 11월 20일\n${quote}`,anyoneReadable:true}]},{query:'예제인물',originalQuery:question});
  const r=runtime({wiki:{results,status:'success'}});
  let reviewSeen=false;
  r.context.generateGeminiAnswer=async(prompt,options)=>{
    if(options.planSearch) return {answer:'정보는 확인되지 않는다.',sourcePlan:{mode:'search',query:'예제인물',purpose:'나이와 활동',externalPrompt:question,localPrompt:'',additionalExternalPrompt:'예제인물 활동'}};
    if(options.localOnly) return {answer:''};
    assert.equal(options.evidenceReview,true);
    assert.match(prompt,/예제인물 활동/);
    assert.match(prompt,/1994-11-20/);
    reviewSeen=true;
    return {evidenceReviews:[{id:0,relevant:true,quote,kind:'unknown'}]};
  };
  await r.context.handleGeminiFallbackMessage(message(question),{now:new Date(now)});
  assert.equal(reviewSeen,true);
  assert.equal(r.sent.length,1);
  assert.match(r.sent[0],/1994-11-20/);
  assert.match(r.sent[0],/만 31세/);
  assert.ok(r.sent[0].includes(quote));
  assert.doesNotMatch(r.sent[0],/정보는 확인되지 않는다|2007-09-14|만 19세/);
});

test('empty planner local fields preserve settings, conversation and supplied text when external lookup fails', async () => {
  const cases = [
    {question:'너 누구고 오늘 부산 날씨는 어때?',local:'나는 설정에 등록된 깐냥이다냥.'},
    {question:'내 예산 조건을 다시 적고 오늘 환율도 확인해줘',local:'대화에서 정한 예산은 15만원이다냥.'},
    {question:'제공한 hello를 번역하고 지금 도쿄 기온도 알려줘',local:'hello의 번역은 안녕이다냥.'},
  ];
  for (const {question,local} of cases) for (const status of ['empty','failed','review-failed']) {
    const history = [{role:'user',text:'예산은 15만원이야.'}];
    const r = runtime({history,reply:{text:'제공 자료: hello'},page:{context:'제공한 원문: hello',pages:[]},search:{status,failed:status!=='empty',results:[],context:''}});
    const calls=[];
    r.context.generateGeminiAnswer=async(prompt,options)=>{
      calls.push({prompt,options});
      if(options.planSearch) return {answer:'',sourcePlan:{mode:'search',query:question.includes('부산')?'부산 날씨':'오늘 환율',purpose:'외부 사실 확인',externalPrompt:'외부 사실 확인',localPrompt:''}};
      assert.equal(options.localOnly,true);
      assert.equal(prompt,question);
      assert.equal(options.history[0].text,history[0].text);
      assert.equal(options.replyContext.text,'제공 자료: hello');
      assert.equal(options.webSearchContext,'제공한 원문: hello');
      return {answer:local};
    };
    await r.context.handleGeminiFallbackMessage(message(question));
    assert.equal(calls.length,2);
    assert.equal(r.sent.length,1);
    assert.ok(r.sent[0].includes(local));
    assert.match(r.sent[0],/확인하지 못|검증하지 못/);
    if(question.includes('부산')) assert.deepEqual(r.queries,['부산 날씨']);
  }
});

test('short weather tables retain title region, actual time, kind and fields without article length thresholds',async()=>{
  const page=extractReadablePageText('<title>부산광역시 남구 용당동 날씨</title><main><time datetime="2026-10-15T18:00:00+09:00">2026년 10월 15일 18시 관측</time><table><tr><td>17°C 구름많음</td><td>체감온도 15°C</td><td>습도 73%</td></tr></table></main>');
  assert.equal(page.bodyQuality,'insufficient');
  const data=await collectWebBodyEvidence('부산 날씨',{status:'success',results:[{url:'https://weather.test/busan'}]},async(_prompt,options)=>{
    assert.match(options.webSearchContext,/부산광역시 남구 용당동/);
    assert.match(options.webSearchContext,/2026-10-15T18:00:00\+09:00/);
    return {evidenceReviews:[{id:0,relevant:true,dataType:'weather',quote:page.text,region:'부산광역시 남구 용당동',validTime:'2026-10-15T18:00:00+09:00',kind:'observation',weatherFields:['17°C 구름많음','체감온도 15°C','습도 73%']}]};
  },{now,readPage:async()=>({...page,url:'https://weather.test/busan'}),search:async()=>{throw Error('short data must not cause a retry');}});
  assert.equal(data.status,'success');
  assert.equal(data.bodyVerification.reads[0].status,'body-extracted');
  assert.match(renderWeatherEvidence(data),/용당동 · 관측 자료/);
  assert.match(renderWeatherEvidence(data),/2026-10-15T18:00:00\+09:00/);
  assert.match(renderWeatherEvidence(data),/습도 73%/);
});

test('weather numbers with missing or invented metadata never become confirmed current weather',async()=>{
  for(const metadata of [{}, {region:'부산',validTime:'2026-10-15 18:00',kind:'observation'}]) {
    const body='17°C 구름많음 체감온도 15°C 습도 73%';
    const data=await collectWebBodyEvidence('부산 현재 날씨',{status:'success',results:[{url:'https://weather.test/unknown'}]},async()=>({evidenceReviews:[{id:0,relevant:true,dataType:'weather',quote:body,weatherFields:['17°C'],...metadata}]}),{readPage:async()=>({url:'https://weather.test/unknown',title:'날씨',text:body})});
    assert.equal(data.results[0].bodyReview.region,'');
    assert.equal(data.results[0].bodyReview.validTime,'');
    assert.match(renderWeatherEvidence(data),/현재 날씨로 확인할 수 없다/);
  }
});

test('short structured non-weather data is reviewed and reviewer failures are not insufficient evidence',async()=>{
  const body='제품 A | 8 GB | 2개';
  const initial={status:'success',results:[{url:'https://table.test/spec'}]};
  const readPage=async()=>({url:'https://table.test/spec',title:'제품 표',text:body,bodyQuality:'insufficient'});
  const data=await collectWebBodyEvidence('제품 A 사양',initial,async()=>({evidenceReviews:[{id:0,relevant:true,dataType:'table',quote:body}]}),{readPage});
  assert.equal(data.status,'success');
  for(const generate of [async()=>{throw Object.assign(Error('secret provider response'),{status:429});},async()=>({answer:''})]) {
    const failed=await collectWebBodyEvidence('제품 A 사양',initial,generate,{readPage});
    assert.equal(failed.status,'review-failed');
    assert.equal(failed.failed,true);
    assert.doesNotMatch(JSON.stringify(failed),/secret provider response/);
  }
});

test('verified article quotations produce a supported paraphrase and never replace summary with copied text',async()=>{
  const quote='개발사는 새 언어 모델의 API를 공개했다. 기업 고객은 문서 분류와 질의응답 기능을 사용할 수 있으며, 제공 범위와 일정은 기사에 설명된 조건에 한정된다.';
  const data={results:[{title:'AI 모델 API 공개',publishedAt:'2026-10-14',url:'https://news.test/model',pageText:quote,bodyReview:{quote}}],newsVerification:{freshnessDays:14}};
  const summary='새 모델의 API가 공개돼 기업 고객이 문서 분류와 질의응답에 활용할 수 있게 됐다냥. https://news.test/model';
  for(const answer of [summary,quote]) {
    let calls=0;
    const final=await answerVerifiedNews(data,async(_prompt,options)=>{
      calls++;
      assert.match(options.webSearchContext,/API/);
      return options.evidenceReview ? {evidenceReviews:[{id:0,relevant:true,quote}]} : {answer,citationsValid:true};
    });
    assert.equal(calls,2);
    assert.match(final,/1건뿐|최근 14일/);
    assert.doesNotMatch(final,/핵심 본문 발췌/);
    if(answer===summary) { assert.ok(final.includes(summary)); assert.ok(!final.includes(quote)); }
    else assert.match(final,/요약 검증에 실패/);
  }
});


test('a failed retry is not hidden by an earlier successful empty search',async()=>{
  const initial={status:'empty',results:[]};
  const search=async()=>({status:'timeout',failed:true,results:[]});
  const web=await collectWebBodyEvidence('예제 자료',initial,async()=>({}),{search});
  const news=await collectNewsEvidence('AI 뉴스',initial,{now,search});
  for(const data of [web,news]) {
    assert.equal(data.status,'retrieval-failed');
    assert.equal(data.failed,true);
  }
});
