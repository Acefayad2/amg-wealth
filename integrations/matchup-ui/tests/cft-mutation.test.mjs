import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// Exercise the actual CFT mutation function with fake services. No browser,
// credentials, network request or production records are used by these tests.
const source = fs.readFileSync(new URL("../app/cft/CFTWorkspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CFTWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let mutation;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "mutateWorkspace") mutation = node;
  ts.forEachChild(node, find);
}
find(ast);
assert.ok(mutation, "CFT mutation implementation must exist");
const compiled = ts.transpileModule(mutation.getText(ast), {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}
function harness({result = {ok:true, calendarStatus:"pending"}, httpOk = true, refreshError = false, refreshGate, fetchError} = {}) {
  const state = {requests:[], refreshes:0, messages:[], busy:[], stale:false};
  const scope = {
    mutationLock:{current:false}, workspaceStale:false, workspaceGeneration:{current:1},
    setMutationBusy:value => state.busy.push(value),
    setWorkspaceStale:value => {state.stale=value;scope.workspaceStale=value;},
    supabase:{auth:{getSession:async()=>({data:{session:{access_token:"synthetic-test-session"}}})}},
    AMG_BACKEND_URL:"https://test.invalid/amg-matchup",
    fetch:async(url, init)=>{
      state.requests.push({url, ...init, payload:JSON.parse(init.body)});
      if (fetchError) throw new Error(fetchError);
      return {ok:httpOk, json:async()=>result};
    },
    refreshWorkspace:async()=>{
      state.refreshes++;
      if (refreshGate) await refreshGate.promise;
      if (refreshError) throw new Error("Synthetic refresh failure");
    },
  };
  // `with` resolves changing state exactly as React's function closure would.
  const run = new Function("scope", `with (scope) { ${compiled}; return mutateWorkspace; }`)(scope);
  const payload={trainerId:"fixture-trainer",appointmentId:"fixture-appointment",status:"confirmed",expectedStatus:"pending"};
  const invoke=()=>run("appointment-response",payload,value=>state.messages.push(value),"");
  return {state,scope,invoke,payload};
}

test("CFT queues calendar wording only after refreshed workspace and blocks repeated submission",async()=>{
  const refreshGate=deferred();
  const h=harness({refreshGate});
  const first=h.invoke();
  await h.invoke();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.state.requests.length,1);
  assert.equal(h.state.refreshes,1);
  assert.deepEqual(h.state.messages,[""]);
  assert.equal(h.scope.mutationLock.current,true);
  assert.deepEqual(h.state.requests[0].payload,{action:"appointment-response",...h.payload});
  refreshGate.resolve();
  await first;
  assert.equal(h.state.messages.at(-1),"Response saved. Calendar update queued.");
  assert.deepEqual(h.state.busy,[true,false]);
  assert.equal(h.scope.mutationLock.current,false);
});

test("CFT distinguishes saved response from failed calendar sync",async()=>{
  const h=harness({result:{ok:true,calendarStatus:"failed"}});
  await h.invoke();
  assert.equal(h.state.messages.at(-1),"Response saved; calendar sync needs attention.");
  assert.equal(h.state.refreshes,1);
});

test("CFT saved response with failed reload marks workspace stale and prevents later changes",async()=>{
  const h=harness({refreshError:true});
  await h.invoke();
  assert.equal(h.state.messages.at(-1),"Your change was saved, but the latest workspace could not be loaded. Refresh before making another change.");
  assert.equal(h.state.refreshes,2);
  assert.equal(h.state.stale,true);
  await h.invoke();
  assert.equal(h.state.requests.length,1);
});

test("CFT incomplete success response is not reported as saved or queued",async()=>{
  const h=harness({result:{calendarStatus:"pending"}});
  await h.invoke();
  assert.equal(h.state.messages.at(-1),"The server did not confirm the response. The workspace has been refreshed; review it before retrying.");
  assert.equal(h.state.refreshes,1);
  assert.equal(h.state.stale,false);
});

test("CFT network failure refreshes authoritative state before allowing retry",async()=>{
  const h=harness({fetchError:"Synthetic network failure"});
  await h.invoke();
  assert.equal(h.state.messages.at(-1),"Synthetic network failure The workspace has been refreshed; review it before retrying.");
  assert.equal(h.state.refreshes,1);
  assert.equal(h.state.stale,false);
  assert.equal(h.scope.mutationLock.current,false);
});

test("CFT missing session never sends an appointment response",async()=>{
  const h=harness();
  h.scope.supabase.auth.getSession=async()=>({data:{session:null}});
  await h.invoke();
  assert.equal(h.state.requests.length,0);
  assert.equal(h.state.messages.at(-1),"Your login expired. Please sign in again. The workspace has been refreshed; review it before retrying.");
});
