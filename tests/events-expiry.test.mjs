import test from 'node:test';
import assert from 'node:assert/strict';
import { eventHasNotEnded } from '../assets/amg-events.mjs';

test('an event remains available through its final day in the event timezone', () => {
  assert.equal(eventHasNotEnded('2027-01-18T08:00:00Z', new Date('2027-01-18T07:59:59Z')), true);
});

test('an event expires at midnight after its final day, including on a later page visit', () => {
  assert.equal(eventHasNotEnded('2027-01-18T08:00:00Z', new Date('2027-01-18T08:00:00Z')), false);
  assert.equal(eventHasNotEnded('2027-01-18T08:00:00Z', new Date('2027-02-01T12:00:00Z')), false);
});

test('invalid event end dates cannot promote a listing', () => {
  assert.equal(eventHasNotEnded('date to be confirmed'), false);
});
