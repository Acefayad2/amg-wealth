import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationAuthFailure} from '../integrations/matchup-backend/supabase/functions/amg-matchup/registration-errors.ts';

test('weak passwords get an actionable field error instead of a generic signup failure',()=>{
  const result=registrationAuthFailure({code:'weak_password',status:422,message:'Password is known to be weak'});
  assert.equal(result.status,400);assert.equal(result.field,'password');assert.match(result.error,/unique password/);
});
test('duplicate logins direct the trainer to sign in and unexpected errors stay private',()=>{
  assert.equal(registrationAuthFailure({code:'email_exists'}).status,409);
  assert.equal(registrationAuthFailure({message:'A user has already been registered'}).field,'email');
  const result=registrationAuthFailure({code:'unexpected_failure',message:'sensitive database details'});
  assert.equal(result.status,503);assert(!result.error.includes('sensitive database'));
});
