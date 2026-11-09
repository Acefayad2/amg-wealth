(() => {const data=window.LESSON02;window.AMG_LESSON={...data,id:'02',number:2,title:"Pooling, large numbers and adverse selection",duration:199};const $=id=>document.getElementById(id);function el(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
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
  function updatePool() {
    const n = Number($('pool-size').value);
    if (![100, 1000, 10000].includes(n)) return;
    const extra = $('extra-claim').checked ? 1 : 0;
    const expected = n * 0.01;
    const illustrated = expected + extra;
    const rate = illustrated / n * 100;
    const percent = rate.toFixed(2) + '%';
    $('expected-claims').textContent = expected.toLocaleString('en-US');
    $('illustrated-claims').textContent = illustrated.toLocaleString('en-US');
    $('illustrated-rate').textContent = percent;
    $('chart-rate').textContent = percent;
    $('illustrated-bar').style.width = (rate / 2 * 100) + '%';
    $('pool-insight').textContent = extra
      ? 'One extra claim changes this group’s rate by ' + (100 / n).toFixed(2) + ' percentage points. Each person’s assumed probability stays at 1%.'
      : 'This illustration matches the expected count. Real results can be above or below it; matching is not guaranteed.';
    const total = (expected * 100000).toLocaleString('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0});
    $('pool-cost').textContent = 'Expected benefits: ' + total + ' total, or $1,000 per person. The expected amount per person stays the same for all three group sizes.';
  }
  $('pool-size').addEventListener('change', updatePool);
  $('extra-claim').addEventListener('change', updatePool);
  updatePool();

})();
