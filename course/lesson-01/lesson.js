(() => {
  'use strict';
  const data = window.LESSON01, total = data.questions.length;
  const key = 'amg-life-lesson-01-v' + data.version;
  const $ = id => document.getElementById(id);
  const blank = () => ({answers:Array(total).fill(null), firstAnswers:Array(total).fill(null), attempts:Array(total).fill(0), videoEnded:false, complete:false});
  const valid = (a,i) => Number.isInteger(a) && a >= 0 && a < data.questions[i].options.length;
  let state = blank(), storageAvailable = true, current = 0, returnFocus = null;
  const mastered = () => state.answers.every((a,i) => a === data.questions[i].answer);
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && ['answers','firstAnswers','attempts'].every(k => Array.isArray(saved[k]) && saved[k].length === total)) {
      state.videoEnded = saved.videoEnded === true;
      if (state.videoEnded) {
        state.answers = saved.answers.map((a,i) => valid(a,i) ? a : null);
        state.firstAnswers = saved.firstAnswers.map((a,i) => valid(a,i) ? a : null);
        state.attempts = saved.attempts.map(a => Number.isSafeInteger(a) && a > 0 ? a : 0);
        state.complete = saved.complete === true && mastered();
      }
    }
  } catch (_) { state = blank(); }
  try { localStorage.setItem(key + '-probe','1'); localStorage.removeItem(key + '-probe'); }
  catch (_) { storageAvailable = false; }
  function save() {
    try { localStorage.setItem(key,JSON.stringify(state)); } catch (_) { storageAvailable = false; }
    $('save-status').textContent = storageAvailable ? 'Progress is saved in this browser.' : 'Storage is unavailable. Keep this page open to retain progress.';
  }
  function el(tag,text,className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const video = $('scenario-video'), dialog = $('lesson-check');
  if (data.video) video.src = data.video;
  if (data.poster) video.poster = data.poster;
  const track = document.createElement('track');
  Object.assign(track,{kind:'captions',label:'English',srclang:'en',src:'scene-captions.vtt',default:true});
  video.append(track);
  video.addEventListener('error',() => { $('video-error').hidden = false; });
  video.addEventListener('loadeddata',() => { $('video-error').hidden = true; });
  $('retry-video').addEventListener('click',() => video.load());
  $('transcript').textContent = data.transcript;
  function selectTerm(index) {
    const term = data.terms[index];
    [...$('term-buttons').children].forEach((button,i) => button.setAttribute('aria-pressed',String(i === index)));
    $('term-detail').replaceChildren(el('h3',term.name),el('p',term.definition),el('p',term.example));
  }
  data.terms.forEach((term,index) => {
    const button = el('button',term.name); button.type = 'button'; button.setAttribute('aria-controls','term-detail');
    button.addEventListener('click',() => selectTerm(index)); $('term-buttons').append(button);
  });
  selectTerm(0);
  function update() {
    const correct = state.answers.filter((a,i) => a === data.questions[i].answer).length;
    const first = state.firstAnswers.filter((a,i) => a === data.questions[i].answer).length;
    const answered = state.firstAnswers.filter(a => a !== null).length;
    $('lesson-progress').max = total; $('lesson-progress').value = correct;
    $('progress-label').textContent = correct + ' of ' + total + ' questions understood';
    $('watch-status').textContent = state.videoEnded ? 'Video finished · Lesson questions unlocked' : 'Watch the lesson, then complete the questions that appear at the end.';
    $('open-check').disabled = !state.videoEnded;
    $('open-check').textContent = state.complete ? 'Review lesson answers' : (answered ? 'Continue lesson questions' : 'Open lesson questions');
    $('result').textContent = state.videoEnded ? correct + ' of ' + total + ' questions correct after review. First answers: ' + first + ' of ' + answered + '.' : 'Finish the video to unlock the eight lesson questions.';
    $('complete').disabled = !state.videoEnded || !mastered() || state.complete;
    $('complete').textContent = state.complete ? 'Lesson finished' : 'Finish this lesson';
    $('completion-status').textContent = state.complete ? 'Part 1 is complete. You can continue to Part 2.' : 'Answer every question correctly, using the explanations and retries as needed, to finish Part 1.';
    $('next-lesson').hidden = !state.complete; $('next-locked').hidden = state.complete;
    save();
  }
  function finish() {
    if (!state.videoEnded || !mastered()) return;
    state.complete = true; update();
    returnFocus = $('completion-status');
    if (dialog.open) dialog.close();
    $('completion-status').focus();
  }
  function renderCheck() {
    const box = $('check-content'); box.replaceChildren();
    $('check-heading').textContent = 'Question ' + (current + 1) + ' of ' + total;
    $('check-progress').textContent = state.answers.filter((a,i) => a === data.questions[i].answer).length + ' of ' + total + ' correct after review';
    const question = data.questions[current], selected = state.answers[current];
    const fieldset = el('fieldset'); fieldset.append(el('legend',question.prompt));
    const options = el('div',undefined,'options');
    question.options.forEach((option,index) => {
      const label = el('label',undefined,'option'), input = document.createElement('input');
      Object.assign(input,{type:'radio',name:'lesson-answer',value:String(index),checked:selected === index,disabled:selected !== null});
      label.append(input,el('span',String.fromCharCode(65 + index) + '. ' + option));
      if (selected !== null && index === question.answer) label.classList.add('correct');
      options.append(label);
    });
    fieldset.append(options); box.append(fieldset);
    const actions = el('div',undefined,'check-actions');
    if (selected === null) {
      const check = el('button','Check answer','primary'); check.disabled = true; check.type = 'button';
      options.addEventListener('change',() => { check.disabled = false; });
      check.addEventListener('click',() => {
        const input = options.querySelector('input:checked'); if (!input || !state.videoEnded) return;
        const answer = Number(input.value);
        if (state.firstAnswers[current] === null) state.firstAnswers[current] = answer;
        state.answers[current] = answer; state.attempts[current] += 1;
        update(); renderCheck(); $('check-feedback').focus();
      }); actions.append(check);
    } else {
      const correct = selected === question.answer;
      const feedback = el('div',undefined,'feedback'); feedback.id = 'check-feedback'; feedback.tabIndex = -1;
      feedback.append(el('h3',correct ? 'Correct.' : 'Review, then try again.'),el('p',question.explanations[selected]));
      const list = el('ul',undefined,'explanations');
      question.options.forEach((option,i) => {
        const item = el('li'); item.append(el('strong',String.fromCharCode(65 + i) + '. ' + option + ' '),document.createTextNode(question.explanations[i])); list.append(item);
      });
      feedback.append(list);
      const review = el('a','Revisit the explanation in the lesson'); review.href = '#' + question.review;
      review.addEventListener('click',() => dialog.close()); feedback.append(review); box.append(feedback);
      if (!correct) {
        const retry = el('button','Try this question again','primary'); retry.type = 'button';
        retry.addEventListener('click',() => { state.answers[current] = null; update(); renderCheck(); box.querySelector('input').focus(); }); actions.append(retry);
      } else if (current < total - 1) {
        const next = el('button','Next question','primary'); next.type = 'button';
        next.addEventListener('click',() => { current += 1; renderCheck(); $('check-heading').focus(); }); actions.append(next);
      } else if (mastered()) {
        const done = el('button',state.complete ? 'Close answer review' : 'Finish Part 1','primary'); done.type = 'button';
        done.addEventListener('click',() => state.complete ? dialog.close() : finish()); actions.append(done);
      } else {
        const missing = el('button','Return to unfinished questions','primary');
        missing.addEventListener('click',() => { current = state.answers.findIndex((a,i) => a !== data.questions[i].answer); renderCheck(); $('check-heading').focus(); }); actions.append(missing);
      }
    }
    if (current > 0) {
      const back = el('button','Previous question'); back.type = 'button';
      back.addEventListener('click',() => { current -= 1; renderCheck(); $('check-heading').focus(); }); actions.append(back);
    }
    box.append(actions);
  }
  async function openCheck() {
    if (!state.videoEnded) return;
    video.pause();
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) {} }
    if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) video.webkitExitFullscreen();
    returnFocus = document.activeElement;
    current = state.answers.findIndex((a,i) => a !== data.questions[i].answer);
    if (current < 0) current = state.complete ? 0 : total - 1;
    renderCheck(); if (!dialog.open) dialog.showModal(); $('check-heading').focus();
  }
  video.addEventListener('ended',() => { state.videoEnded = true; update(); if (!state.complete) openCheck(); });
  $('open-check').addEventListener('click',openCheck);
  $('close-check').addEventListener('click',() => dialog.close());
  dialog.addEventListener('close',() => {
    const target = returnFocus && returnFocus !== document.body ? returnFocus : $('open-check');
    target.focus({preventScroll:true});
  });
  $('complete').addEventListener('click',finish);
  $('restart').addEventListener('click',() => {
    const ended = state.videoEnded; state = blank(); state.videoEnded = ended; update(); if (ended) openCheck();
  });
  update();
})();
