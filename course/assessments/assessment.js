(async () => {
 'use strict';
 const account=await window.AMG_ACCOUNT?.ready;if(!account)return;
 const storage=account.storage;
 const data=window.AMG_ASSESSMENTS,KEY='amg-life-assessments-v'+data.version,DAY=86400000,rotation=window.AMG_ASSESSMENT_ROTATION;
 const $=id=>document.getElementById(id),app=$('app'),formById=new Map(data.forms.map(f=>[f.id,f]));
 const questions=new Map([...data.forms.flatMap(f=>f.questions),...data.lessons.flatMap(l=>l.questions)].map(q=>[q.id,q]));
 const lessonById=new Map(data.lessons.map(l=>[l.id,l]));
 const blank=()=>({version:data.version,attempts:[],seen:[],reviews:{},lessonImports:{}});
 let storedSnapshot=null;
 let state=blank(),storageAvailable=true,corrupt=false,currentAttempt=null,pendingSubmit=null;
 function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
 function button(text,fn,cls){const e=node('button',text,cls);e.type='button';e.addEventListener('click',fn);return e;}
 function link(text,url){const e=node('a',text);e.href=url;return e;}
 function read(key){try{const raw=storage.getItem(key);if(key===KEY)storedSnapshot=raw;return JSON.parse(raw||'null');}catch(e){if(e.name==='SecurityError')storageAvailable=false;return null;}}
 function validChoice(x){return x===null||(Number.isInteger(x)&&x>=0&&x<4);}
 function restore(){
  const saved=read(KEY);if(!saved)return;
  if(saved.version!==data.version||!Array.isArray(saved.attempts)){corrupt=true;return;}
  state.seen=Array.isArray(saved.seen)?saved.seen.filter(id=>formById.has(id)):[];
  state.reviews={};
  for(const[id,r]of Object.entries(saved.reviews||{}))if(questions.has(id)&&r&&Number.isFinite(r.nextDue)&&Number.isInteger(r.stage)&&r.stage>=0&&r.stage<=3){state.reviews[id]={nextDue:r.nextDue,stage:r.stage,history:Array.isArray(r.history)?r.history.filter(h=>h&&typeof h.questionId==='string'&&Number.isFinite(h.at)):[],lastMissAt:Number.isFinite(r.lastMissAt)?r.lastMissAt:null,lastMissId:typeof r.lastMissId==='string'?r.lastMissId:null};}
  state.lessonImports=saved.lessonImports&&typeof saved.lessonImports==='object'?saved.lessonImports:{};
  const used=new Set();
  for(const a of saved.attempts){
   if(!a||typeof a!=='object'){corrupt=true;continue;}
   const f=formById.get(a.form);if(!f||typeof a.id!=='string'||used.has(a.id)||!Number.isFinite(a.startedAt)||!Array.isArray(a.answers)||a.answers.length!==f.questions.length||!a.answers.every(validChoice)){corrupt=true;continue;}
   const n=f.questions.length;used.add(a.id);
   state.attempts.push({id:a.id,form:f.id,startedAt:a.startedAt,deadline:f.minutes?a.startedAt+f.minutes*60000:null,submittedAt:Number.isFinite(a.submittedAt)?a.submittedAt:null,expired:a.expired===true,fresh:a.fresh===true,answers:a.answers,flags:Array.from({length:n},(_,i)=>a.flags?.[i]===true),uncertain:Array.from({length:n},(_,i)=>a.uncertain?.[i]===true),reviewed:Array.from({length:n},(_,i)=>a.reviewed?.[i]===true),current:Number.isInteger(a.current)&&a.current>=0&&a.current<n?a.current:0});
   if(!state.seen.includes(f.id))state.seen.push(f.id);
  }
 }
 function storageStatus(){const s=$('storage-status');s.classList.toggle('warning',!storageAvailable||corrupt);s.textContent=!storageAvailable?'Progress is pending. Keep this page open until it is saved.':corrupt?'Some saved assessment data could not be restored. Valid attempts and lesson progress remain available.':account.statusText();}
 function save(){if(!account.canWrite())return;try{const serialized=JSON.stringify(state),previous=storedSnapshot;if(previous!==serialized){storedSnapshot=serialized;account.commitSnapshot(KEY,serialized,previous).catch(()=>{storageAvailable=false;storageStatus();});}}catch(_){storageAvailable=false;}storageStatus();}
 restore();try{storage.setItem(KEY+'-probe','1');storage.removeItem(KEY+'-probe');}catch(_){storageAvailable=false;}
 function queue(qid,when=Date.now(),missId=null){
  const at=Math.min(when,Date.now()),r=state.reviews[qid];
  if(!r){state.reviews[qid]={stage:0,nextDue:at+DAY,history:[],lastMissAt:at,lastMissId:missId};return;}
  // Only a distinct, dated miss can restart review; old imports must not move the due date.
  if(!missId||r.lastMissId===missId)return;
  const latestReview=r.history.reduce((latest,h)=>Math.max(latest,h.at),0);
  if(at<=Math.max(r.lastMissAt||0,latestReview))return;
  r.stage=0;r.nextDue=at+DAY;r.lastMissAt=at;r.lastMissId=missId;
 }
 function lessonProgress(){
  return data.lessons.map(l=>{
   const key='amg-life-lesson-'+l.id+'-v'+l.version,s=read(key),ready=s?.videoEnded===true||s?.transcriptRead===true;
   const valid=ready&&Array.isArray(s?.answers)&&s.answers.length===l.questions.length;
   const complete=Boolean(valid&&s.complete===true&&s.answers.every((a,i)=>a===l.questions[i].answer));
   if(ready&&Array.isArray(s?.firstAnswers)&&s.firstAnswers.length===l.questions.length){
    const fingerprint=JSON.stringify([s.firstAnswers,s.completedAt||null,s.practiceAttemptId||null,s.firstAnswerAt||null]);
    if(state.lessonImports[key]!==fingerprint){
     const date=Date.parse(s.completedAt);
     s.firstAnswers.forEach((a,i)=>{
      if(!Number.isInteger(a)||a<0||a>=4||a===l.questions[i].answer)return;
      const rawAt=Array.isArray(s.firstAnswerAt)?s.firstAnswerAt[i]:null;
      const at=typeof rawAt==='string'?Date.parse(rawAt):rawAt;
      const dated=Number.isFinite(at)&&at>0&&typeof s.practiceAttemptId==='string'&&s.practiceAttemptId.length>0;
      queue(l.questions[i].id,dated?at:Number.isFinite(date)?date:Date.now(),dated?key+':'+s.practiceAttemptId+':'+i:null);
     });state.lessonImports[key]=fingerprint;
    }
   }
   return{lesson:l,complete,completedAt:complete?s.completedAt||null:null};
  });
 }
 function score(a){const f=formById.get(a.form),scored=f.questions.map((q,i)=>({q,i})).filter(x=>x.q.scored),correct=scored.filter(({q,i})=>a.answers[i]===q.answer).length;return{correct,total:scored.length,percent:correct/scored.length*100};}
 const dateText=t=>new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 const dayKey=t=>{const d=new Date(t);return[d.getFullYear(),d.getMonth(),d.getDate()].join('-');};
 function route(params={}){const u=new URL(location.href);u.search='';for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);history.pushState({},'',u);render();window.scrollTo({top:0,behavior:'instant'});}
 function heading(kicker,title,text){const h=node('section',undefined,'assessment-hero');h.append(node('p',kicker,'eyebrow'),node('h1',title),node('p',text));return h;}
 function focusHeading(){const h=app.querySelector('h1,legend,h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
 function submit(a,expired=false){
  if(!account.canWrite()||a.submittedAt)return;
  a.submittedAt=expired&&a.deadline?a.deadline:Date.now();a.expired=expired;
  formById.get(a.form).questions.forEach((q,i)=>{if(a.answers[i]!==q.answer||a.uncertain[i])queue(q.id,a.submittedAt,'attempt:'+a.id);});save();
 }
 function expire(){if(!account.canWrite())return false;let changed=false;for(const a of state.attempts)if(!a.submittedAt&&a.deadline&&Date.now()>=a.deadline){submit(a,true);changed=true;}return changed;}
 function active(a){if(!account.canWrite())return false;if(a.submittedAt)return false;if(a.deadline&&Date.now()>=a.deadline){submit(a,true);render();window.scrollTo({top:0,behavior:'instant'});return false;}return true;}
 function start(f){
  if(!account.canWrite())return;
  const pending=state.attempts.find(a=>a.form===f.id&&!a.submittedAt);
  if(pending){route({attempt:pending.id});return;}
  const now=Date.now(),n=f.questions.length,a={id:crypto.randomUUID(),form:f.id,startedAt:now,deadline:f.minutes?now+f.minutes*60000:null,submittedAt:null,expired:false,fresh:!state.seen.includes(f.id),answers:Array(n).fill(null),flags:Array(n).fill(false),uncertain:Array(n).fill(false),reviewed:Array(n).fill(false),current:0};
  state.attempts.push(a);if(!state.seen.includes(f.id))state.seen.push(f.id);save();route({attempt:a.id});
 }
 function dashboard(){
  const progress=lessonProgress(),complete=progress.filter(p=>p.complete).length;
  app.append(heading('YOUR PRACTICE SPACE','Practice Test','Start anytime. Questions rotate between new attempts, and a started attempt keeps the same question set.'));
  const cards=node('div',undefined,'cards practice-cards');
  const f=rotation.nextPracticeForm(data.forms,state.attempts),pending=state.attempts.find(a=>a.form===f?.id&&!a.submittedAt),hasAttempts=state.attempts.some(a=>a.form!=='D');
  if(f){const card=node('section',undefined,'card practice-card');card.dataset.practice='life';
   const top=node('div',undefined,'practice-card-top');top.append(node('span','LIFE PRODUCER','eyebrow'),node('span',pending?'In progress':hasAttempts?'Ready for another attempt':'Ready to start','form-state'+(pending?' is-pending':'')));card.append(top);
   card.append(node('h2','Life Practice Test'),node('p','A balanced exam-style question set that rotates when you begin a new attempt.','form-description'));
   const facts=node('div',undefined,'form-facts');facts.append(node('span',f.questions.length+' questions'),node('span',f.minutes+' minutes'));card.append(facts);
   card.append(node('p',pending?'Your timer and question set are unchanged. Resume before the timer expires.':'80 scored questions + 10 simulation items. Starting locks this attempt to one question set.','fine form-note'));
   const action=button(pending?'Resume Practice Test':hasAttempts?'Start New Practice Test':'Start Practice Test',()=>start(f),'primary form-start');action.setAttribute('aria-label',pending?'Resume Life Practice Test':'Start Life Practice Test');card.append(action);cards.append(card);
  }app.append(cards);
  const due=Object.entries(state.reviews).filter(([,r])=>r.stage<3&&r.nextDue<=Date.now()),upcoming=Object.entries(state.reviews).filter(([,r])=>r.stage<3).sort((a,b)=>a[1].nextDue-b[1].nextDue);
  const support=node('div',undefined,'practice-support');
  const review=node('section',undefined,'card review-card');review.append(node('p','KEEP IT FRESH','eyebrow'),node('h2',due.length?due.length+' reviews due':'Your review queue'));
  if(due.length){review.append(node('p','Revisit concepts you missed or felt unsure about.'),button('Start due review',()=>route({review:due[0][0]}),'primary'));}
  else review.append(node('p',upcoming.length?'Next review: '+dateText(upcoming[0][1].nextDue)+'.':'Nothing due yet. Missed and uncertain answers will appear here.','review-empty'));
  const reviewMethod=node('details',undefined,'inline-details');reviewMethod.append(node('summary','How review works'),node('p','Missed lesson first answers, assessment misses and answers marked uncertain enter review. Another question from the same lesson is used when available; returning to a known item is labeled as repeat practice.'),node('p','Review intervals: 1 day after a miss, then 3 days after the first successful review, then 7 days after the second. A miss restarts the 1-day interval.'));review.append(reviewMethod);support.append(review);
  const panel=node('section',undefined,'card status-panel');panel.append(node('p','YOUR COURSE','eyebrow'),node('h2',complete+' of 60 parts complete'));
  const next=progress.find(x=>!x.complete);panel.append(node('p',next?'Pick up where you left off.':'All lesson requirements are complete.'),link(next?'Continue with Part '+next.lesson.number:'Review your course',next?'/course/lesson-'+next.lesson.id+'/':'/course/'));
  const completionInfo=node('details',undefined,'inline-details');completionInfo.append(node('summary','What counts as complete?'),node('p','A part counts after its study prerequisite, every correct required answer and its explicit finish step. The Practice Test is optional and does not change lesson completion. Course completion is a study record, not a licensing approval or an accredited CE certificate.'));panel.append(completionInfo);support.append(panel);app.append(support);
  const historySection=node('details',undefined,'practice-disclosure attempt-history');historySection.append(node('summary','Attempt history'+(state.attempts.length?' · '+state.attempts.length:'')));
  const list=node('ul',undefined,'history-list');
  for(const a of [...state.attempts].reverse()){
   const s=score(a),li=node('li');li.append(node('span','Practice Test · '+dateText(a.startedAt)+' · '+(a.submittedAt?s.correct+'/'+s.total+' ('+Math.round(s.percent)+'%)'+(a.expired?' · Time expired':''):'In progress')+' · '+(a.fresh?'First exposure':'Repeat practice')),button(a.submittedAt?'Review result':'Resume',()=>route({attempt:a.id})));list.append(li);
  }
  historySection.append(list.children.length?list:node('p','Your completed and in-progress tests will appear here.','empty'));app.append(historySection);renderEvidence(complete);
  const guide=node('details',undefined,'practice-disclosure');guide.append(node('summary','How the Practice Test works'),node('p','Each attempt has 90 questions and a 105-minute limit. Eighty questions count toward its main score; ten AMG simulation items are identified only after submission. A new attempt rotates to another balanced question set.'),node('p','Answer without hints. You can skip, flag and change answers before submitting. Feedback appears afterward. A started attempt keeps the same questions and its timer continues while you are away.'),node('p','First exposure and repeat practice remain separate in your study record. These original AMG questions are not an official exam or a promise of passing.'));app.append(guide);
  const exportBox=node('section',undefined,'export-panel');exportBox.append(node('div',undefined,'export-copy'));exportBox.firstChild.append(node('h2','Keep your study record'),node('p','Download your progress for your backup or coordinator.','export-note'));exportBox.append(button('Download study record',()=>{
   const exportData={exportedAt:new Date().toISOString(),course:'AMG Maryland Life',lessonProgress:progress.map(p=>({id:p.lesson.id,title:p.lesson.title,complete:p.complete,completedAt:p.completedAt})),assessmentProgress:state};
   const url=URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'})),a=link('Download',url);a.download='amg-life-study-record.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }));app.append(exportBox);save();
 }
 function renderEvidence(complete){
  const fresh=state.attempts.filter(a=>a.submittedAt&&a.fresh),mocks=fresh.filter(a=>a.form!=='D'),hits=mocks.filter(a=>score(a).percent>=85),days=new Set(hits.map(a=>dayKey(a.submittedAt)));
  const outstanding=mocks.reduce((n,a)=>n+formById.get(a.form).questions.filter((q,i)=>(a.answers[i]!==q.answer||a.uncertain[i])&&!a.reviewed[i]).length,0);
  const section=node('details',undefined,'practice-disclosure study-evidence');section.append(node('summary','Study insights'),node('h2','Evidence of understanding'),node('p','Optional AMG study target: complete the course, reach at least 85% on two previously unseen Practice Test question sets on separate days, and review misses and uncertain answers. Tests are not required to finish the course. This target is not Prometric’s cut score and has not been validated as a pass predictor.'));
  const met=complete===60&&hits.length>=2&&days.size>=2&&outstanding===0;
  section.append(node('p',met?'The course and two-attempt study target are met. Review the domain evidence below before deciding your next step.':complete+' / 60 parts · '+hits.length+' fresh question sets at 85%+ · '+days.size+' qualifying study days · '+outstanding+' mock explanations awaiting review.','notice'));
  const table=node('table'),head=node('tr');for(const s of ['Domain','Fresh scored answers','Evidence'])head.append(node('th',s));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
  data.domains.forEach((name,d)=>{let n=0,right=0;for(const a of fresh)formById.get(a.form).questions.forEach((q,i)=>{if(q.scored&&q.domain===d){n++;if(a.answers[i]===q.answer)right++;}});const row=node('tr');row.append(node('td',name),node('td',n?right+' / '+n+' · '+Math.round(right/n*100)+'%':'No sample'),node('td',n<20?'Small sample: more evidence needed':right/n>=.8?'At least 80% in this sample':'Revisit this domain'));body.append(row);});
  table.append(body);const wrap=node('div',undefined,'table-scroll');wrap.append(table);section.append(wrap,node('p','Only first-exposure answers are included here; simulation items and repeat practice are excluded. Some domains have small samples, so a high percentage alone is weak evidence. Lesson retries are learning practice, not fresh exam scores.','fine'));app.append(section);
 }
 function exam(a){
  currentAttempt=a;const f=formById.get(a.form),q=f.questions[a.current];
  const bar=node('div',undefined,'exam-bar'),left=node('div');left.append(node('strong','Life Practice Test'),node('div','Question '+(a.current+1)+' of '+f.questions.length));bar.append(left);const timer=node('span',f.minutes?'':'Untimed','timer');timer.id='timer';timer.setAttribute('role','timer');timer.setAttribute('aria-label','Time remaining');bar.append(timer);app.append(bar);
  const layout=node('div',undefined,'exam-layout'),panel=node('section',undefined,'question-panel'),fieldset=node('fieldset');fieldset.append(node('legend',q.prompt));
  q.options.forEach((text,i)=>{const label=node('label',undefined,'answer-option'),input=document.createElement('input');Object.assign(input,{type:'radio',name:'exam-answer',value:String(i),checked:a.answers[a.current]===i});input.addEventListener('change',()=>{if(!active(a))return;a.answers[a.current]=i;save();updateNav(a);});label.append(input,node('span',String.fromCharCode(65+i)+'. '+text));fieldset.append(label);});panel.append(fieldset);
  const unsure=node('label',undefined,'confidence'),cb=document.createElement('input');cb.type='checkbox';cb.checked=a.uncertain[a.current];cb.addEventListener('change',()=>{if(!active(a))return;a.uncertain[a.current]=cb.checked;save();});unsure.append(cb,node('span','I’m uncertain about this answer — include it in later review'));panel.append(unsure);
  const actions=node('div',undefined,'actions'),prev=button('Previous',()=>move(a,a.current-1)),next=button('Next',()=>move(a,a.current+1));prev.disabled=a.current===0;next.disabled=a.current===f.questions.length-1;
  const flag=button(a.flags[a.current]?'Unmark question':'Mark for review',()=>{if(!active(a))return;a.flags[a.current]=!a.flags[a.current];save();examRender(a);});flag.setAttribute('aria-pressed',String(a.flags[a.current]));actions.append(prev,next,flag,button('Clear answer',()=>{if(!active(a))return;a.answers[a.current]=null;save();examRender(a);}));panel.append(actions,node('p','You can change answers, skip questions and return to marked items. No explanations are shown until submission.','fine'));
  panel.append(button('Review & submit',()=>{if(!active(a))return;pendingSubmit=a;const unanswered=a.answers.filter(x=>x===null).length;$('submit-detail').textContent=unanswered+' unanswered · '+a.flags.filter(Boolean).length+' marked. Unanswered scored questions count as incorrect. Submitting locks this attempt and reveals the explanations.';$('submit-dialog').showModal();},'primary'));
  const nav=node('aside',undefined,'nav-panel');nav.append(node('h2','Question navigator'));const status=node('p',undefined,'question-status');status.id='answered-status';nav.append(status);const grid=node('div',undefined,'question-nav');grid.id='question-nav';grid.setAttribute('aria-label','Jump to a question');f.questions.forEach((_,i)=>{const b=button(String(i+1),()=>move(a,i));b.dataset.index=String(i);grid.append(b);});nav.append(grid,node('p','Filled: answered · Gold line: marked · Outline: current','fine'),button('Return to dashboard',()=>route()),node('p',f.minutes?'The timer keeps running while you are away.':'This saved attempt has no time limit.','fine'));layout.append(panel,nav);app.append(layout);updateNav(a);updateTimer();
 }
 function updateNav(a){const f=formById.get(a.form);$('answered-status').textContent=a.answers.filter(x=>x!==null).length+' of '+f.questions.length+' answered';document.querySelectorAll('#question-nav button').forEach((b,i)=>{b.classList.toggle('answered',a.answers[i]!==null);b.classList.toggle('marked',a.flags[i]);b.classList.toggle('current',a.current===i);b.setAttribute('aria-label','Question '+(i+1)+(a.answers[i]!==null?', answered':', unanswered')+(a.flags[i]?', marked':''));if(a.current===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});}
 function move(a,i){if(!active(a))return;if(i<0||i>=a.answers.length)return;a.current=i;save();examRender(a);focusHeading();window.scrollTo({top:0,behavior:'instant'});}
 function examRender(a){app.replaceChildren();exam(a);focusHeading();}
 function updateTimer(){if(!currentAttempt||currentAttempt.submittedAt||!$('timer')||!currentAttempt.deadline)return;const seconds=Math.max(0,Math.ceil((currentAttempt.deadline-Date.now())/1000)),m=Math.floor(seconds/60),s=seconds%60;$('timer').textContent=m+':'+String(s).padStart(2,'0');$('timer').classList.toggle('urgent',seconds<=300);}
 function results(a){
  const f=formById.get(a.form),s=score(a);app.append(heading(a.fresh?'FIRST-EXPOSURE RESULT':'REPEAT-PRACTICE RESULT','Life Practice Test',a.expired?'Time expired. This attempt was submitted using the answers saved before the deadline.':'This attempt is submitted. Review why each answer fits before starting another attempt.'));
  app.append(node('p',s.correct+' / '+s.total+' · '+Math.round(s.percent)+'%','score'),node('p',(a.fresh?'First exposure':'Repeat practice — excluded from fresh-question-set evidence')+' · '+dateText(a.submittedAt)+' · '+(f.id==='D'?'Archived attempt; not a pass/fail decision':'AMG study target: 85%; not the official exam cut score'),'fine'));
  if(f.id!=='D'){const sim=f.questions.map((q,i)=>({q,i})).filter(x=>!x.q.scored),right=sim.filter(({q,i})=>a.answers[i]===q.answer).length;app.append(node('p','Simulation items: '+right+' / 10 correct. These ten original AMG items are excluded from the main score and are labeled below.','notice'));}
  const actions=node('div',undefined,'actions');actions.append(button('Return to dashboard',()=>route(),'primary'),button('Show only misses / uncertain',()=>{document.querySelectorAll('.result-question').forEach(e=>e.hidden=e.dataset.needsReview!=='true');}),button('Show all answers',()=>{document.querySelectorAll('.result-question').forEach(e=>e.hidden=false);}));app.append(actions);
  const byDomain=node('table'),hr=node('tr');hr.append(node('th','Domain'),node('th','Scored result'));const th=node('thead');th.append(hr);byDomain.append(th);const tb=node('tbody');data.domains.forEach((name,d)=>{const sample=f.questions.map((q,i)=>({q,i})).filter(x=>x.q.scored&&x.q.domain===d),right=sample.filter(({q,i})=>a.answers[i]===q.answer).length,row=node('tr');row.append(node('td',name),node('td',right+' / '+sample.length));tb.append(row);});byDomain.append(tb);app.append(byDomain);
  f.questions.forEach((q,i)=>{
   const selected=a.answers[i],correct=selected===q.answer,needs=!correct||a.uncertain[i],box=node('details',undefined,'result-question');box.dataset.needsReview=String(needs);
   box.append(node('summary',(i+1)+'. '+(correct?'Correct':'Review')+(a.uncertain[i]?' · Uncertain':'')+(!q.scored?' · Simulation — excluded':'')+' · '+q.prompt));
   box.append(node('p','Your answer: '+(selected===null?'Unanswered':String.fromCharCode(65+selected)+'. '+q.options[selected])));
   const list=node('ol');list.type='A';q.options.forEach((o,j)=>list.append(node('li',o+(j===q.answer?' — Correct':''),j===q.answer?'answer-correct':'')));box.append(list,node('p',q.explanation));
   const refs=node('p',undefined,'review-links');refs.append(link('Revisit Part '+Number(q.lesson)+': '+lessonById.get(q.lesson).title,'/course/lesson-'+q.lesson+'/'));box.append(refs);
   if(q.sources.length){const sourceDetails=node('details');sourceDetails.append(node('summary','Sources for the related lesson'));const ul=node('ul');q.sources.forEach(s=>{const li=node('li');li.append(link(s.title,s.url));ul.append(li);});sourceDetails.append(ul);box.append(sourceDetails);}
   if(needs){const label=node('label',undefined,'confidence'),cb=document.createElement('input');cb.type='checkbox';cb.checked=a.reviewed[i];cb.addEventListener('change',()=>{a.reviewed[i]=cb.checked;save();});label.append(cb,node('span','I’ve reviewed the explanation and the distinction I missed'));box.append(label,node('p','This topic is also scheduled for delayed practice. Acknowledging the explanation does not change your original score.','fine'));}
   app.append(box);
  });
 }
 function review(qid){
  const r=state.reviews[qid],original=questions.get(qid);if(!r||!original){route();return;}
  app.append(heading('DELAYED RETRIEVAL','Review Part '+Number(original.lesson),lessonById.get(original.lesson).title));
  if(r.stage>=3||r.nextDue>Date.now()){app.append(node('p',r.stage>=3?'The three scheduled reviews are complete. Keep practicing across the course.':'Your next review is scheduled for '+dateText(r.nextDue)+'.'),button('Back to dashboard',()=>route(),'primary'));return;}
  const used=new Set([qid,...r.history.map(h=>h.questionId)]),pool=lessonById.get(original.lesson).questions,alternates=pool.filter(q=>!used.has(q.id)),q=alternates[0]||original;
  app.append(node('p',alternates.length?'Another original question from this lesson. Apply the explanation to these facts.':'Repeat practice: the available alternative items have been used. This is not counted as fresh exam evidence.','notice'));
  const field=node('fieldset');field.append(node('legend',q.prompt));q.options.forEach((o,i)=>{const label=node('label',undefined,'answer-option'),input=document.createElement('input');Object.assign(input,{type:'radio',name:'review-answer',value:String(i)});label.append(input,node('span',String.fromCharCode(65+i)+'. '+o));field.append(label);});app.append(field);
  const check=button('Check review answer',()=>{
   const selected=field.querySelector('input:checked');if(!selected)return;const correct=Number(selected.value)===q.answer;check.disabled=true;field.querySelectorAll('input').forEach(x=>x.disabled=true);
   const feedback=node('div',undefined,'review-result');feedback.setAttribute('role','status');feedback.append(node('h2',correct?'Correct.':'Review this distinction.'),node('p','Correct answer: '+q.options[q.answer]),node('p',q.explanation||q.explanations[q.answer]));
   if(correct){r.history.push({questionId:q.id,at:Date.now(),correct:true});r.stage+=1;r.nextDue=Date.now()+([0,3,7,0][r.stage])*DAY;feedback.append(node('p',r.stage>=3?'All three scheduled reviews are complete.':'Next review in '+(r.stage===1?3:7)+' days.'));}
   else{r.history.push({questionId:q.id,at:Date.now(),correct:false});r.stage=0;r.nextDue=Date.now()+DAY;feedback.append(node('p','Revisit the teaching now. Another review is scheduled for tomorrow.'));}
   save();feedback.append(link('Read the lesson','/course/lesson-'+q.lesson+'/'),button('Back to dashboard',()=>route(),'primary'));app.append(feedback);feedback.tabIndex=-1;feedback.focus();
  },'primary');check.disabled=true;field.addEventListener('change',()=>check.disabled=false);app.append(check);
 }
 function render(){currentAttempt=null;app.replaceChildren();expire();const params=new URLSearchParams(location.search),a=state.attempts.find(x=>x.id===params.get('attempt'));if(a){a.submittedAt?results(a):exam(a);}else if(params.has('review'))review(params.get('review'));else dashboard();storageStatus();focusHeading();}
 $('confirm-submit').addEventListener('click',()=>{if(pendingSubmit){if(active(pendingSubmit))submit(pendingSubmit);pendingSubmit=null;$('submit-dialog').close();render();window.scrollTo({top:0,behavior:'instant'});}});
 $('cancel-submit').addEventListener('click',()=>{$('submit-dialog').close();pendingSubmit=null;});
 $('submit-dialog').addEventListener('cancel',()=>pendingSubmit=null);
 window.addEventListener('popstate',render);
 account.subscribe(e=>{if(e.source==='local'){storageStatus();return;}if(e.key===KEY){state=blank();restore();render();}else if(e.key===null){storageStatus();}else if(e.key?.startsWith('amg-life-lesson-')&&!currentAttempt)render();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){const visibleAttempt=currentAttempt;if(expire()){if($('submit-dialog').open)$('submit-dialog').close();render();if(visibleAttempt?.submittedAt)window.scrollTo({top:0,behavior:'instant'});}else updateTimer();}});
 setInterval(()=>{const visibleAttempt=currentAttempt;if(expire()){pendingSubmit=null;if($('submit-dialog').open)$('submit-dialog').close();render();if(visibleAttempt?.submittedAt)window.scrollTo({top:0,behavior:'instant'});}else updateTimer();},1000);
 render();
})();
