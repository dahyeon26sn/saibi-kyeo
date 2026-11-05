/*
 * 사이비켜 — 포교 의심도 판별 엔진 v2
 *
 * 입력: 사용자가 적은 상황 문장 (+ 선택: 체크리스트 응답)
 * 출력: { level: '상'|'중'|'하'|'판단 어려움', score, signals[], safes[], followUps[] }
 *
 * v1(단어 하나 포함 여부)에서 바꾼 점
 *  1. 단어 대신 "표현 패턴"으로 찾기  (예: '복' → '복이 많다', '다음' → '다음에 또 만나자')
 *  2. 부정문 처리                    (예: "연락처는 안 물어봤어요" → 위험 신호로 세지 않음)
 *  3. 안심 신호로 점수 낮추기         (학생회·공식 설문, 아는 사람, 바로 물러남 등)
 *  4. 근거가 부족하면 '판단 어려움' + 되묻는 질문
 *  5. 위험한 조합(연락처+재만남, 비밀 요구 등)은 최소 '중' 이상
 */
(function (global) {
  'use strict';

  // ── 위험 신호 ──────────────────────────────────────────────
  // id, 점수, 화면에 보일 설명, 패턴 목록, inherentNeg: 부정 표현 자체가 신호인 경우
  const RISK = [
    { id: 'contact', w: 3, label: '연락처나 SNS를 요구했어요',
      // 연락 수단 + 요구/교환 동사가 함께 있어야 함 ("카톡 했어요"는 해당 없음)
      re: [/(연락처|전화\s*번호|번호|카톡|카카오톡|인스타|sns|디엠|dm|아이디|이메일|주소)\s*(을|를|만|좀|랑|이랑|도)?\s*.{0,8}(알려|달라|달래|달라고|줘|줬|주면|주세요|드렸|교환|남겨|적어|물어|묻|받아|받았|받더|요구|따)/i] },
    { id: 'move', w: 3, label: '다른 장소로 데려가려 했어요',
      re: [/(카페|센터|사무실|공간|장소|교회|모임\s*장소|건물|방)\s*(로|으로|에)?\s*.{0,10}(가자|가요|가서|데려|와\s*보|오라|오래|가보|이동|따라오)/,
           /(자리|장소)\s*를?\s*옮기/, /(근처|가까운\s*곳|조용한\s*곳)\s*(으로|로|에)?\s*(가자|가서|가요|이동)/, /따뜻한\s*곳/, /같이\s*(가자|가요|갈래|가\s*보자|가\s*달)/, /(선생님|선배|아는\s*분|좋은\s*분|강사|멘토)\s*(을|를)?\s*소개/] },
    { id: 'revisit', w: 3, label: '다시 만나자고 했어요',
      re: [/(다음에|또|다시|나중에|주말에|내일|다음\s*주)\s*.{0,8}(만나|보자|봐요|볼래|오라|와\s*줄|와요|와야|와라|오세요|나와|연락\s*(할|줄|드릴))/,
           /결과\s*(를|는)?\s*.{0,8}(알려|보여|설명|해석).{0,10}(만나|연락|와|오)/, /약속\s*(을|을\s*좀)?\s*(잡|정하)/,
           /(정기|매주|계속)\s*(모임|만나|나오|나와)/, /모임\s*에\s*(나오|나와|오라|와)/, /한\s*번\s*더\s*(만나|와)/] },
    { id: 'test', w: 2, label: '심리 검사나 고민 상담을 내세웠어요',
      re: [/심리\s*(테스트|검사|상담)/, /성격\s*(검사|테스트|유형)/, /mbti/i, /퍼스널\s*컬러/, /애니어그램|에니어그램/, /색채\s*(검사|심리)/,
           /(무료|공짜)\s*(로\s*)?(검사|상담|테스트|진단)/, /미술\s*치료/, /고민\s*(이\s*있어\s*보|있어\s*보|상담|들어\s*주)/, /상담\s*(을|을\s*좀)?\s*(해\s*주|해준|받아\s*보)/] },
    { id: 'flattery', w: 3, label: '인상·기운 칭찬으로 접근했어요',
      re: [/인상\s*(이|이\s*정말|이\s*참)?\s*(좋|밝|선하)/, /얼굴\s*(이|에서)?\s*.{0,4}(밝|빛|좋아\s*보)/, /기운\s*(이|을)/, /관상/, /복\s*(이|을)\s*(많|있|받)/,
           /좋은\s*말씀/, /운세|팔자|사주/] },
    { id: 'spirit', w: 3, label: '조상·영적인 이야기를 꺼냈어요',
      re: [/조상/, /덕\s*(이|을)\s*(많|있|쌓)/, /영적|영혼|축복|구원|천국|하나님\s*(의|이|께서)|하느님/, /도(를)?\s*아십니까/, /제사|천도재|굿\s*(을|하)|기도\s*(를|해\s*주|받)/] },
    { id: 'study', w: 2, label: '공부 모임이나 강의를 권했어요',
      re: [/성경|말씀\s*공부|복음/, /인문학\s*(공부|모임|강의|스터디)/, /철학\s*(모임|공부|강의)/, /(무료|공짜)\s*.{0,4}(강의|공부|세미나|강좌|클래스)/,
           /공부\s*모임/, /(독서|토론)\s*모임/] },
    { id: 'hideorg', w: 3, label: '소속이나 단체를 밝히지 않았어요', inherentNeg: true,
      re: [/(소속|단체|어디\s*(서|에서)?\s*(나왔|오셨|왔)|어느\s*(교회|단체)|어떤\s*(단체|곳)|종교).{0,14}(얼버무|피하|피했|회피|안\s*알려|말\s*안|대답\s*(을)?\s*(안|못|피)|모른다|비밀|밝히지|말\s*못|돌려\s*말)/,
           /종교\s*(는|랑)?\s*(아니|없|상관\s*없)(다|어|라|고)/, /종교\s*(단체|모임)\s*(는|가)?\s*아니/, /그냥\s*좋은\s*(모임|단체|곳)/, /(주최|주관|운영)\s*(가|는|이|하는\s*곳)?\s*.{0,8}(안\s*써|없|모르|밝히지|안\s*알려)/] },
    { id: 'secret', w: 4, label: '다른 사람에게 비밀로 하라고 했어요', inherentNeg: true,
      re: [/비밀\s*(로|이|을)/, /(말하지|얘기하지|알리지)\s*(마|말|않)/, /아무(한테|에게)도/, /(가족|부모님|친구)\s*(한테|에게|들한테)?\s*.{0,8}(말|얘기|알리)\s*(하지)?\s*(마|말라|말고)/] },
    { id: 'persist', w: 3, label: '거절해도 계속 붙잡았어요',
      re: [/거절\s*.{0,12}(계속|또|따라|붙잡|안\s*놓)/, /(계속|자꾸)\s*(따라|붙잡|쫓|말을\s*걸|연락)/, /따라\s*(오|왔|와서)/, /(계속|자꾸|끝까지)\s*.{0,4}붙잡/, /놓아\s*주지|안\s*놔\s*주|끈질기/] },
    { id: 'pretext', w: 1, label: '설문·인터뷰·촬영을 부탁했어요',
      re: [/설문/, /인터뷰/, /촬영|영상\s*(찍|제작)/, /졸업\s*(작품|과제|논문)/, /(과제|레포트)\s*(때문|로|를\s*위해)/] },
    { id: 'timeask', w: 2, label: '시간을 내 달라거나 이야기하자고 했어요',
      re: [/시간\s*(좀|잠깐|잠시)?\s*(있|괜찮|내\s*줄|내\s*주)/, /얘기\s*(좀|를)?\s*(하자|해요|나누|할\s*수)/, /(꼭|한번|한\s*번)\s*(와|오라|와\s*달|와\s*보|놀러)/, /초대/] },
    { id: 'stranger', w: 1, label: '모르는 사람이 먼저 다가왔어요',
      re: [/낯선|모르는\s*(사람|분|여자|남자|학생)/, /처음\s*보는/, /(길|거리|정류장|역\s*앞|정문|후문)\s*(에서|을\s*걷|에서\s*걷)/, /(두|세)\s*(명|사람)이\s*(오|와|다가)/, /다가\s*(와|오|와서|왔)/, /말\s*을\s*걸/, /지나가는데/] },
  ];

  // ── 안심 신호 (점수 낮춤) ──────────────────────────────────
  const SAFE = [
    { id: 'official', w: -2, label: '학교·학생회 등 공식 활동으로 보여요',
      re: [/학생회|총학|과\s*사무실|학과\s*(사무실|행사|공지)|조교|교수님/, /공식\s*(설문|링크|홈페이지|계정|행사)/, /구글\s*폼|qr\s*코드/i, /에브리타임\s*(공지|게시)/] },
    { id: 'registered', w: -2, label: '등록된 동아리로 확인됐어요',
      re: [/등록\s*(된|돼\s*있는)\s*동아리/, /중앙\s*동아리|동아리\s*연합회|동연/, /동아리\s*박람회/] },
    { id: 'known', w: -1, label: '원래 아는 사람이에요',
      re: [/(과|같은\s*과|반|동아리)\s*(동기|선배|후배|친구)|룸메|친한\s*(친구|선배|후배)|아는\s*(선배|후배|형|언니|누나|오빠)/, /팀플\s*(조원|팀원)/] },
    { id: 'leftquick', w: -2, label: '거절하자 바로 물러났어요',
      re: [/(거절|괜찮다고|싫다고)\s*.{0,10}(바로|그냥|순순히)\s*(가|갔|물러|보내|끝)/, /바로\s*(물러|보내\s*줬|끝났)/, /(바로|그냥)\s*(알겠다|가셨|갔|가더|가던)/] },
    { id: 'nodata', w: -1, label: '개인정보를 묻지 않았어요',
      re: [/(연락처|번호|개인\s*정보|이름).{0,10}(안\s*물|묻지\s*않|안\s*받|필요\s*없|요구\s*(하지\s*)?않|없었)/, /익명/] },
    { id: 'help', w: -2, label: '단순한 도움 요청이었어요',
      re: [/길\s*만\s*물|길을\s*물어\s*보고\s*(바로|그냥)/, /(사진|핸드폰\s*충전|배터리)\s*.{0,6}(부탁|빌려)/] },
  ];

  // 부정 표현: 매칭된 표현 바로 뒤(같은 절 안)에 오면 그 신호를 세지 않음
  const NEG_AFTER = /^.{0,12}?(안\s*(물|했|하|받|줬|주|알려|갔|따라)|않|없었|없어|없더|아니|못\s*(했|하)|안\s*했)/;
  const NEG_BEFORE = /(안|않고|없이|말고)\s*$/;

  function clauses(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/[.!?…\n]|(?:는데|지만|더니|면서|고서|그리고|그런데|근데)\s/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function findSignal(def, cls) {
    for (const c of cls) {
      for (const re of def.re) {
        const m = c.match(re);
        if (!m) continue;
        if (!def.inherentNeg && def.w > 0) {
          const after = c.slice(m.index + m[0].length);
          const before = c.slice(Math.max(0, m.index - 4), m.index);
          const inside = /(^|\s)안\s|않|못\s/.test(m[0]);
          if (inside || NEG_AFTER.test(after) || NEG_BEFORE.test(before)) continue; // 부정문 → 건너뜀
        }
        return { id: def.id, w: def.w, label: def.label, evidence: m[0] };
      }
    }
    return null;
  }

  // 체크리스트 응답: 'yes' | 'no' | undefined
  const CHECK = [
    { id: 'contact', q: '연락처나 SNS를 물어봤나요?', yes: 3, no: -1 },
    { id: 'move', q: '다른 장소로 가자고 하거나 다시 만나자고 했나요?', yes: 3, no: -1 },
    { id: 'hideorg', q: '소속·단체를 물었을 때 대답을 피했나요?', yes: 3, no: -1 },
    { id: 'persist', q: '거절했는데도 계속 붙잡았나요?', yes: 3, no: -1 },
  ];

  function judge(text, checks) {
    const cls = clauses(text);
    const signals = RISK.map(d => findSignal(d, cls)).filter(Boolean);
    const safes = SAFE.map(d => findSignal(d, cls)).filter(Boolean);

    // 체크리스트 반영
    const ids = new Set(signals.map(s => s.id));
    let checkScore = 0;
    let answered = 0;
    if (checks) {
      CHECK.forEach(c => {
        const a = checks[c.id];
        if (a === 'yes') {
          answered++;
          if (!ids.has(c.id) && !(c.id === 'move' && ids.has('revisit'))) {
            const def = RISK.find(r => r.id === c.id);
            signals.push({ id: c.id, w: c.yes, label: def.label, evidence: '체크리스트' });
            ids.add(c.id);
          }
        } else if (a === 'no') {
          answered++;
          if (!ids.has(c.id)) checkScore += c.no;
        }
      });
    }

    const risk = signals.reduce((s, x) => s + x.w, 0);
    const safe = safes.reduce((s, x) => s + x.w, 0);
    let score = risk + safe + checkScore;

    // 핵심 신호(맥락 신호 stranger/pretext 제외)
    const core = signals.filter(s => s.id !== 'stranger' && s.id !== 'pretext');

    let level;
    if (score >= 6) level = '상';
    else if (score >= 3) level = '중';
    else level = '하';

    // 위험한 조합은 최소 '중', 매우 위험하면 '상'
    const has = id => ids.has(id);
    const lure = ['pretext', 'test', 'study', 'flattery', 'spirit', 'timeask'].some(has);
    if (has('stranger') && lure) { score += 1; }                 // 낯선 사람 + 미끼
    level = score >= 6 ? '상' : score >= 3 ? '중' : '하';
    if (has('secret') || has('hideorg')) level = level === '하' ? '중' : level;
    if (has('contact') && (has('revisit') || has('move'))) level = '상';
    if (has('move') && signals.length >= 2) level = '상';         // 장소 이동 + 다른 신호
    if ((has('flattery') || has('spirit')) && (has('move') || has('revisit'))) level = '상';
    if (has('secret') && core.length >= 2) level = '상';

    // 근거가 거의 없음 → 판단 어려움 (짧거나 상황 설명이 없는 입력)
    const plain = String(text || '').replace(/\s/g, '');
    if (core.length === 0 && safes.length === 0 && answered === 0 && score < 3 && plain.length < 15) {
      level = '판단 어려움';
    }

    // 되묻기: 아직 모르는 핵심 사항
    const followUps = level === '상' ? [] : CHECK
      .filter(c => !ids.has(c.id) && !(c.id === 'move' && ids.has('revisit')) && !(checks && checks[c.id]))
      .map(c => ({ id: c.id, q: c.q }));

    return { level, score, signals, safes, followUps, version: 'v2' };
  }

  // ── v1(기존) 엔진: 비교용으로 그대로 보관 ─────────────────
  const LEGACY_RULES = [[/연락처|번호|전화번호|카톡|인스타|sns|아이디/i, 3], [/다시|다음|또 만나|결과.*보여|약속/, 3], [/심리|성격|테스트|검사/, 2],
    [/설문|조사/, 2], [/인상|복|조상|기운|운세|관상/, 3], [/공부|성경|인문학|강의|세미나/, 2], [/동아리|봉사|행사|문화/, 1],
    [/인터뷰|촬영|영상|졸업 작품/, 2], [/비밀|말하지 마|아무한테도/, 4], [/따라|계속|붙잡/, 3], [/단체|어디서|어느 교회|대답.*(피|안)/, 2]];
  function judgeLegacy(t) {
    let s = 0; LEGACY_RULES.forEach(([re, w]) => { if (re.test(t)) s += w; });
    return { level: s >= 6 ? '상' : s >= 3 ? '중' : '하', score: s, version: 'v1' };
  }

  const api = { judge, judgeLegacy, CHECK, RISK, SAFE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SaibiJudge = api;
})(typeof window !== 'undefined' ? window : globalThis);
