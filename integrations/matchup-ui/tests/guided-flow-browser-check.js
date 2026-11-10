async (page) => {
  const requests = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  let matches = 0, books = 0;
  const trainers = [
    {id:'qa-trainer-1',name:'QA Trainer One',initials:'Q1',location:'Maryland',years:5,specialties:['Families'],about:'Synthetic trainer for local testing.',match:96,color:'emerald',slots:['1:00 PM','2:00 PM']},
    {id:'qa-trainer-2',name:'QA Trainer Two',initials:'Q2',location:'Virginia',years:4,specialties:['Planning'],about:'Synthetic trainer for local testing.',match:92,color:'gold',slots:['3:00 PM','4:00 PM']}
  ];
  await page.unrouteAll({behavior:'wait'});
  await page.route('**/functions/v1/amg-matchup', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.action === 'stats') return route.fulfill({json:{availableToday:2}});
    if (body.action === 'match') {
      matches++;
      if (matches === 1) return route.fulfill({status:404,json:{error:'No CFT has an open time on that date. Please choose another date.'}});
      return route.fulfill({json:{trainers}});
    }
    if (body.action === 'book') {
      books++;
      if (books === 1) return route.fulfill({status:409,json:{error:'That appointment time was just taken. Please choose another time.'}});
      if (books === 2) return route.abort('failed');
      if (books === 3) return route.fulfill({json:{ok:true}});
      return route.fulfill({json:{ok:true,appointmentId:'qa-only',emailStatus:'pending',calendarStatus:'not_connected',smsStatus:'consent_saved'}});
    }
    throw new Error('Unexpected API action: '+body.action);
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3188/');
  await page.getByRole('heading',{name:'First, what’s your name?'}).waitFor();
  assert(await page.locator('.guided-answer input').count()===1,'Only one question should appear');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Please answer this question before continuing.').waitFor();
  await page.getByRole('textbox',{name:'Agent name',exact:true}).fill('QA Agent');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('textbox',{name:'Agent email',exact:true}).fill('not-an-email');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Please enter a valid email address.').waitFor();
  await page.getByRole('textbox',{name:'Agent email',exact:true}).fill('agent@example.invalid');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert(await page.getByRole('textbox',{name:'Agent name',exact:true}).inputValue()==='QA Agent','Back must preserve answers');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  assert(await page.getByRole('textbox',{name:'Agent email',exact:true}).inputValue()==='agent@example.invalid','Forward must preserve answers');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('textbox',{name:'Agent phone',exact:true}).fill('2025550123');
  assert(!(await page.getByRole('checkbox').isChecked()),'Agent SMS must default unchecked');
  await page.getByRole('checkbox').check();
  await page.getByRole('textbox',{name:'Agent phone',exact:true}).fill('2025550124');
  assert(!(await page.getByRole('checkbox').isChecked()),'Changing phone must revoke consent');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  for (const [label,value] of [['Client name','QA Client'],['Client email','client@example.invalid'],['Client phone','2025550125']]) {
    await page.getByRole('textbox',{name:label,exact:true}).fill(value);
    if (label==='Client phone') assert(!(await page.getByRole('checkbox').isChecked()),'Client SMS must default unchecked');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
  }
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Please answer this question before continuing.').waitFor();
  await page.getByRole('radio',{name:'Young family / new parents'}).check();
  await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'/Users/ace/Developer/amg-matchup-guided-qa-20261105/output/playwright/mobile-question.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),'Mobile layout must not overflow horizontally');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('radio',{name:'Income replacement planning'}).check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('textbox',{name:'Client details',exact:true}).fill('Too short');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Please include between 10 and 1000 characters').waitFor();
  await page.getByRole('textbox',{name:'Client details',exact:true}).fill('Discuss family income protection. Synthetic QA only.');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Preferred date',{exact:true}).fill('2026-12-10');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Preferred time',{exact:true}).fill('13:00');
  await page.getByRole('button',{name:'Review answers'}).click();
  await page.getByRole('heading',{name:'Does everything look right?'}).waitFor();
  assert(matches===0 && books===0,'No booking or match requests before review');
  await page.getByRole('button',{name:'Edit agent name',exact:true}).click();
  await page.getByRole('button',{name:'Back to review'}).click();
  await page.getByRole('button',{name:'Edit agent name',exact:true}).click();
  await page.getByRole('textbox',{name:'Agent name',exact:true}).fill('QA Agent Updated');
  await page.getByRole('button',{name:'Save & review'}).click();
  await page.getByText('QA Agent Updated',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Find my trainer'}).evaluate(button=>{button.click();button.click();});
  await page.getByText('No CFT has an open time on that date. Please choose another date.').waitFor();
  await page.getByRole('button',{name:'Choose another date'}).click();
  await page.getByLabel('Preferred date',{exact:true}).fill('2026-12-11');
  await page.getByRole('button',{name:'Save & review'}).click();
  await page.getByRole('button',{name:'Find my trainer'}).evaluate(button=>{button.click();button.click();});
  await page.getByRole('heading',{name:'Your best match'}).waitFor();
  assert(await page.locator('.guided-card').count()===0,'Questionnaire must not compete with trainer result');
  assert(await page.getByRole('button',{name:'Request appointment'}).isDisabled(),'Slot is required');
  await page.getByRole('button',{name:'Choose another trainer'}).click();
  await page.getByRole('heading',{name:'QA Trainer Two',exact:true}).waitFor();
  await page.getByRole('button',{name:'3:00 PM',exact:true}).click();
  await page.getByRole('button',{name:'Request appointment'}).click();
  await page.getByText('That appointment time was just taken. Please choose another time.').waitFor();
  await page.getByRole('button',{name:'4:00 PM',exact:true}).click();
  await page.getByRole('button',{name:'Request appointment'}).click();
  await page.getByRole('alert').filter({hasText:'We couldn’t confirm whether this request was saved.'}).waitFor();
  assert(await page.getByRole('button',{name:'Change details'}).isDisabled(),'Uncertain save prevents creating a different request');
  await page.getByRole('button',{name:'Check request again'}).evaluate(button => {button.click();button.click();});
  await page.getByRole('alert').filter({hasText:'We couldn’t confirm whether this request was saved.'}).waitFor();
  await page.getByRole('button',{name:'Check request again'}).click();
  await page.getByRole('heading',{name:'Your appointment request is saved.'}).waitFor();
  assert(books===4,'Exactly four synthetic attempts expected');
  const b=requests.filter(r=>r.action==='book');
  assert(b[0].bookingId!==b[1].bookingId,'Changing slot after known conflict needs new booking ID');
  assert(b[1].bookingId===b[2].bookingId && b[2].bookingId===b[3].bookingId,'Network and malformed response retries must reuse booking ID');
  assert(b[2].notificationConsent.agent===true && b[2].notificationConsent.client===false,'Consent must match explicit choices');
  assert(b[2].agent.name==='QA Agent Updated' && b[2].appointment.date==='2026-12-11','Edited answers must reach payload');
  assert(await page.locator('main').getAttribute('inert')!==null,'Underlying content must be inert while success dialog is open');
  await page.getByText('Email delivery is pending.').waitFor();
  await page.getByText('Text preferences saved. Confirmation and reminder delivery depends on AMG’s messaging setup.').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading',{name:'Who is the appointment for?'}).waitFor();
  assert(await page.getByRole('textbox',{name:'Client name',exact:true}).inputValue()==='','New appointment clears client details');
  assert(await page.getByRole('dialog').count()===0,'Dismissal must close dialog');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert(await page.getByRole('textbox',{name:'Agent phone',exact:true}).inputValue()==='2025550124','New appointment retains agent details');
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'/Users/ace/Developer/amg-matchup-guided-qa-20261105/output/playwright/desktop-question.png',fullPage:true});
  assert(errors.length===0,'No browser errors expected: '+errors.join(';'));
  console.log(JSON.stringify({passed:true,matches,books,checks:27,browserErrors:errors,network:'All backend requests intercepted; no real appointments or messages'}));
}
