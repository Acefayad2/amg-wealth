(function(root){
 'use strict';
 function practiceForms(forms){return forms.filter(form=>form.id!=='D');}
 function nextPracticeForm(forms,attempts){
  const available=practiceForms(forms);if(!available.length)return null;
  const ids=new Set(available.map(form=>form.id));
  const pending=attempts.find(attempt=>ids.has(attempt.form)&&!attempt.submittedAt);
  if(pending)return available.find(form=>form.id===pending.form)||available[0];
  const previous=[...attempts].reverse().find(attempt=>ids.has(attempt.form));
  if(!previous)return available[0];
  const index=available.findIndex(form=>form.id===previous.form);
  return available[(index+1)%available.length];
 }
 root.AMG_ASSESSMENT_ROTATION={practiceForms,nextPracticeForm};
})(typeof window==='undefined'?globalThis:window);
