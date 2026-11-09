const $ = id => document.getElementById(id);
const el = (tag,text,className) => {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const labels={published:'Published · approval pending','not-built':'No dedicated lesson',partial:'Partial teaching',intro:'Introduction only'};
let audit;
function render(){
 const term=$('search').value.trim().toLowerCase(), domain=$('domain').value, status=$('status').value;
 const rows=audit.rows.filter(r=>(domain==='all'||r.section===domain)&&(status==='all'||(status==='no-questions'?!r.courseQuestions.length:r.evidence.status===status))&&(!term||[r.id,r.title,r.lesson,r.evidence.text,...r.topics.map(t=>t.title),...r.topics.flatMap(t=>t.evidence?.teaching.map(e=>e.title)||[])].join(' ').toLowerCase().includes(term)));
 $('count').textContent=`${rows.length} of ${audit.rows.length} subsections · All await coordinator approval`;
 $('rows').replaceChildren();
 for(const r of rows){
  const detail=el('details');detail.id='outline-'+r.id;const summary=el('summary',r.id+' · '+r.title);
  summary.append(el('span',labels[r.evidence.status],'badge '+r.evidence.status));detail.append(summary);
  const body=el('div',undefined,'detail-body');body.append(el('p',r.evidence.text,'evidence'));
  if(r.evidence.links.length){const p=el('p');for(const [title,url]of r.evidence.links){const a=el('a',title);a.href=url;p.append(a,document.createTextNode('  '));}body.append(p);}
  body.append(el('p','Published teaching: '+r.lesson));
  const list=el('ul',undefined,'topics');for(const topic of r.topics){const li=el('li',topic.title);li.append(el('small','Teaching: '+[...new Set(topic.evidence.teaching.map(x=>'Part '+Number(x.lesson)))].join(', ')+' · Questions: '+topic.evidence.questions.map(x=>x.id).join(', ')));list.append(li);}body.append(list);
  body.append(el('p','Application focus: '+r.example));body.append(el('p','Practice task: '+r.assessment));
  body.append(el('p',r.questionIds.length?'Primary bank references: '+r.questionIds.map(id=>'Q'+id+(audit.questionAudit[id].status==='held'?' (held)':'')).join(', ')+'. These do not cover every checkpoint.':'No primary match in the legacy drill; course question evidence is shown above.'));
  body.append(el('p',r.approval,'pending'));const source=el('a','Official outline · page '+r.pages.join('–'));source.href=r.source;body.append(source);detail.append(body);$('rows').append(detail);
 }
 if(!rows.length)$('rows').append(el('p','No matching subsection. Try a broader search or reset the filters.'));
}
async function init(){try{
 const response=await fetch('audit.json');if(!response.ok)throw Error('Audit unavailable');audit=await response.json();
 $('metrics').replaceChildren();for(const [value,label]of [[audit.summary.subsections,'outline subsections mapped'],[audit.summary.topicGroups,'AMG teaching checkpoints'],[audit.summary.availableLessons,'published lessons'],[audit.summary.lessonQuestions,'required lesson questions']]){const box=el('div',undefined,'metric');box.append(el('strong',String(value)),el('span',label));$('metrics').append(box);}
 for(const s of audit.sections){const option=el('option',s.title);option.value=s.id;$('domain').append(option);const row=el('tr');for(const item of[s.title,s.items,s.share+'%',s.activeQuestions])row.append(el('td',String(item)));$('blueprint').append(row);}
 for(const [id,q]of Object.entries(audit.questionAudit).filter(([,q])=>q.status==='held')){const detail=el('details');detail.append(el('summary','Q'+id+' · '+q.subsection),el('p',q.note));$('held').append(detail);}
 for(const s of audit.sources){const li=el('li'),a=el('a',s.title);a.href=s.url;li.append(a,el('span',s.note));$('source-list').append(li);}
 for(const id of ['search','domain','status'])$(id).addEventListener(id==='search'?'input':'change',render);
 $('clear').addEventListener('click',()=>{$('search').value='';$('domain').value='all';$('status').value='all';render();});render();
 }catch(error){$('load-error').hidden=false;$('metrics').textContent='Audit data unavailable.';}}
let openBeforePrint=[];
window.addEventListener('beforeprint',()=>{openBeforePrint=[...document.querySelectorAll('details')].map(d=>[d,d.open]);for(const[d]of openBeforePrint)d.open=true;});
window.addEventListener('afterprint',()=>{for(const[d,open]of openBeforePrint)d.open=open;});
$('print').addEventListener('click',()=>window.print());
init();
