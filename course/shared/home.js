(async () => {
 const account=await window.AMG_ACCOUNT?.ready;if(!account)return;
 const storage=account.storage;
 const rows=[...document.querySelectorAll('[data-lesson]')],panels=[...document.querySelectorAll('[data-module]')],buttons=[...document.querySelectorAll('[data-module-button]')],search=document.getElementById('lesson-search');
 const $=id=>document.getElementById(id);
 let selected='0',initialized=false;
 const normalize=text=>text.trim().toLocaleLowerCase().replace(/\b([a-z]+)ies\b/g,'$1y');
 function filter(){
  const query=normalize(search.value);let matches=0;
  for(const panel of panels){let shown=0;for(const row of panel.querySelectorAll('[data-lesson]')){const match=!query||normalize('lesson '+Number(row.dataset.lesson)+' '+row.dataset.lesson+' '+row.dataset.title+' '+panel.querySelector('h2').textContent).includes(query);row.hidden=!match;if(match)shown++;}panel.hidden=query?!shown:panel.dataset.module!==selected;if(!panel.hidden)matches+=shown;}
  buttons.forEach(b=>b.setAttribute('aria-pressed',String(!query&&b.dataset.moduleButton===selected)));
  $('search-empty').hidden=matches>0;
  $('lesson-search-status').textContent=query?matches+' matching lessons':'';
  $('browser-label').textContent=query?'SEARCH RESULTS':'COURSE CONTENT';
 }
 function refresh(){
  let count=0,next=null,available=true;const completedByModule={};
  for(const row of rows){
   let saved=null;try{saved=JSON.parse(storage.getItem('amg-life-lesson-'+row.dataset.lesson+'-v'+row.dataset.version)||'null');}catch(_){available=false;}
   const keys=row.dataset.answers.split(',').map(Number),complete=saved?.complete===true&&(saved.videoEnded===true||saved.transcriptRead===true)&&Array.isArray(saved.answers)&&saved.answers.length===keys.length&&saved.answers.every((a,i)=>a===keys[i]);
   row.classList.toggle('is-complete',complete);row.querySelector('.lesson-state').textContent=complete?'Completed':'Start';
   row.querySelector('.lesson-play').innerHTML=complete?'<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>':'<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg>';
   if(complete){count++;completedByModule[row.dataset.moduleIndex]=(completedByModule[row.dataset.moduleIndex]||0)+1;}else next ||= row;
  }
  $('course-progress').textContent=count+' of '+rows.length+' lessons completed'+(available?'':' · Storage unavailable');
  $('course-percent').textContent=Math.round(count/rows.length*100)+'%';$('course-progress-bar').value=count;
  document.querySelectorAll('[data-module-progress]').forEach(x=>{const n=x.dataset.moduleProgress;x.textContent=(completedByModule[n]||0)+' / '+rows.filter(r=>r.dataset.moduleIndex===n).length;});
  const link=$('continue-course'),preview=$('continue-preview-link');
  if(next){
   preview.hidden=false;link.href=preview.href=next.querySelector('a').getAttribute('href');link.querySelector('span').textContent=count?'Continue lesson':'Start lesson';
   $('continue-label').textContent=count?'PICK UP WHERE YOU LEFT OFF':'LET’S GET STARTED';$('continue-title').textContent=next.dataset.title;
   $('continue-meta').textContent='PART '+next.dataset.lesson+' · '+next.dataset.duration+' VIDEO';$('continue-duration').textContent=next.dataset.duration;
   const poster=next.dataset.poster;if(poster)$('continue-poster').src=poster;
   preview.setAttribute('aria-label','Open lesson '+Number(next.dataset.lesson)+': '+next.dataset.title);
   if(!initialized)selected=next.dataset.moduleIndex;
  }else{
   link.href=preview.href='/course/assessments/';link.querySelector('span').textContent='Explore practice tests';$('continue-label').textContent='ALL LESSONS COMPLETED';$('continue-meta').textContent=rows.length+' OF '+rows.length+' COMPLETE';$('continue-title').textContent='Course complete. Keep your knowledge sharp.';preview.hidden=true;
  }
  initialized=true;filter();
 }
 buttons.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.moduleButton;search.value='';filter();}));
 search.addEventListener('input',filter);$('clear-search').addEventListener('click',()=>{search.value='';filter();search.focus();});
 window.addEventListener('pageshow',refresh);account.subscribe(refresh);refresh();
})();
