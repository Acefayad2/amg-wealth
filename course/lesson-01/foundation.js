(() => {const data=window.LESSON01;window.AMG_LESSON={...data,id:'01',number:1,title:"Risk, perils and hazards",duration:256};const $=id=>document.getElementById(id);function el(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
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

})();
