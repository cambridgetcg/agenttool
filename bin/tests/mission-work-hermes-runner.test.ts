/** Stdlib Python fixtures; no provider, native credentials, API, or global edits. */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../mission-work-hermes-runner.py', import.meta.url));
const manifest = fileURLToPath(new URL('../mission-work-hermes-runtime.json', import.meta.url));
const python = ['/usr/bin/python3', '/opt/homebrew/bin/python3'].find(existsSync)!;
const prelude = String.raw`
import importlib.util,json,os,pathlib,sqlite3,sys,tempfile,types,unittest.mock as mock
spec=importlib.util.spec_from_file_location('worker',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def job():
    text='Selected alpha line\nSelected beta line\n'
    return {'format':'agenttool-hermes-source-job/v1','task_id':'12345678-1234-4234-8234-123456789abc',
      'terms':'sha256:'+'1'*64,'source':{'sha256':m.digest(text.encode()),'bytes':len(text.encode()),'text':text},
      'instruction':'Observe two source lines.','acceptance_criteria':['Two accurate quotations'],
      'challenge':'2'*64,'hermes_root':'/tmp'}
def call(name=m.TOOL,args='{}',ident='read-1'):
    return types.SimpleNamespace(id=ident,function=types.SimpleNamespace(name=name,arguments=args))
def denied(fn,code=None):
    try: fn()
    except m.RunnerError as exc:
        if code: assert exc.code==code,(exc.code,code)
        return
    raise AssertionError('Expected refusal')
def final(guard):
    return {'challenge':guard.job['challenge'],'artifact':{'observations':[
      {'line':1,'quote':'alpha','note':'The first line names alpha.'},
      {'line':2,'quote':'beta','note':'The second line names beta.'}]}}
def result(guard):
    return {'completed':True,'turn_exit_reason':'text_response(stop)','final_response':json.dumps(final(guard))}
`;
function fixture(code: string) {
  const out = spawnSync(python, ['-I', '-B', '-c', prelude + '\n' + code, runner], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 100_000,
    env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
  });
  expect({ status: out.status, error: out.error?.message, stdout: out.stdout, stderr: out.stderr }).toEqual({ status: 0, error: undefined, stdout: '', stderr: '' });
}

describe('pathless Hermes source guard', () => {
  test('serves only immutable selected UTF-8 bytes without a file handler', () => fixture(String.raw`
j=job();g=m.SourceGuard(j);j['source']['text']='changed after admission'
with mock.patch('builtins.open',side_effect=AssertionError('model file access')),mock.patch('os.open',side_effect=AssertionError('model file access')):
    output=g.batch([call()])
assert len(output)==1 and output[0]['tool_name']==m.TOOL
assert m.strict_json(output[0]['content'])['source']['text']==job()['source']['text']
assert m.strict_json(output[0]['content'])['challenge']==job()['challenge']
assert g.reads==[{'tool_call_id':'read-1','result_sha256':m.digest(output[0]['content'].encode())}]
assert g.forbidden==0
`));

  test('rejects paths, unknown fields, malformed/duplicate JSON and inline tool names', () => fixture(String.raw`
for name in ['read_file','search_files','memory','session_search','delegate_task','terminal','execute_code','tool_call','mcp_secret','context_summary','']:
    g=m.SourceGuard(job())
    with mock.patch('builtins.open',side_effect=AssertionError('forbidden file read')):
        denied(lambda:g.batch([call(name)]),'TOOL_REQUEST_DENIED')
    assert not g.reads and g.forbidden
for args in ['','{','{,}','None','null','[]','{"path":"/private/credential"}','{"a":1,"a":2}','{"start_line":1}','{"x":NaN}']:
    g=m.SourceGuard(job());denied(lambda:g.batch([call(args=args)]),'TOOL_REQUEST_DENIED')
    assert not g.reads and g.forbidden
`));

  test('whole mixed/concurrent batches execute zero allowed reads; duplicate IDs refuse', () => fixture(String.raw`
for calls in [[call(),call('read_file',ident='bad')],[call('delegate_task'),call(ident='allowed')],[call(),call()]]:
    g=m.SourceGuard(job());denied(lambda:g.batch(calls),'TOOL_REQUEST_DENIED');assert not g.reads
g=m.SourceGuard(job());g.batch([call(ident='a'),call(ident='b')]);assert len(g.reads)==2
denied(lambda:g.batch([call(ident='a')]),'TOOL_REQUEST_DENIED');assert len(g.reads)==2
g=m.SourceGuard(job());denied(lambda:g.batch([call(ident=str(i)) for i in range(5)]),'TOOL_REQUEST_DENIED');assert not g.reads
`));

  test('subclass bypasses native executors and denies every alternate entrypoint', () => fixture(String.raw`
class FakeAgent:
    def _execute_tool_calls(self,*args): raise AssertionError('native dispatch reached')
    def _flush_messages_to_session_db(self,messages): self.flushed=list(messages)
g=m.SourceGuard(job());A=m.guarded_class(FakeAgent,g);a=A();a.tools=m.TOOLS;a.valid_tool_names={m.TOOL};messages=[]
a._execute_tool_calls(types.SimpleNamespace(tool_calls=[call()]),messages,'task')
assert len(messages)==1 and a.flushed==messages and a._build_system_prompt('PRIVATE CONTEXT')==m.SYSTEM_PROMPT
for method in ['_execute_tool_calls_sequential','_execute_tool_calls_concurrent','_invoke_tool','_dispatch_delegate_task','_run_codex_app_server_turn','_spawn_background_review','_repair_tool_call']:
    denied(lambda:getattr(a,method)('anything'),'TOOL_REQUEST_DENIED')
a.tools=[];denied(lambda:a._execute_tool_calls(types.SimpleNamespace(tool_calls=[call()]),[],'task'),'TOOL_REQUEST_DENIED')
assert len(g.reads)==1
`));

  test('requires complete turn, actual read, challenge and exact bounded quotations', () => fixture(String.raw`
g=m.SourceGuard(job());denied(lambda:m.validate_final(result(g),g),'READ_EVIDENCE_MISSING')
g.batch([call()]);assert m.validate_final(result(g),g)==final(g)
for field,value in [('completed',False),('partial',True),('failed',True),('interrupted',True),('turn_exit_reason','max_iterations')]:
    r=result(g);r[field]=value;denied(lambda:m.validate_final(r,g),'NATIVE_TURN_INCOMPLETE')
r=result(g);f=final(g);f['challenge']='3'*64;r['final_response']=json.dumps(f);denied(lambda:m.validate_final(r,g),'CHALLENGE_MISMATCH')
for change in ['wrong-quote','same-line','extra','long-note']:
    f=final(g)
    if change=='wrong-quote':f['artifact']['observations'][0]['quote']='fabricated'
    if change=='same-line':f['artifact']['observations'][1]['line']=1
    if change=='extra':f['artifact']['path']='/tmp/output'
    if change=='long-note':f['artifact']['observations'][0]['note']='x'*121
    r=result(g);r['final_response']=json.dumps(f);denied(lambda:m.validate_final(r,g))
g.forbidden=1;denied(lambda:m.validate_final(result(g),g),'READ_EVIDENCE_MISSING')
`));

  test('selected source input is strict, closed and independently hashed', () => fixture(String.raw`
assert m.validate_job(job())==job()
for change in ['source','bytes','extra','surrogate','negative','uuid']:
    j=job()
    if change=='source':j['source']['text']='substitute'
    if change=='bytes':j['source']['bytes']+=1
    if change=='extra':j['path']='/secret'
    if change=='surrogate':j['source']['text']='\ud800'
    if change=='negative':j['source']['bytes']=-1
    if change=='uuid':j['task_id']='12345678-1234-4234-8234-123456789ABC'
    denied(lambda:m.validate_job(j))
denied(lambda:m.strict_json('{"x":1,"x":2}'),'INVALID_JSON')
denied(lambda:m.strict_json('{"x":NaN}'),'INVALID_JSON')
`));

  test('CRLF and CR source line numbering matches the signed work profile', () => fixture(String.raw`
for separator in ['\n','\r\n','\r']:
    j=job();text='Selected alpha line'+separator+'Selected beta line'+separator
    j['source']={'sha256':m.digest(text.encode()),'bytes':len(text.encode()),'text':text}
    g=m.SourceGuard(j);g.batch([call()]);assert m.validate_final(result(g),g)==final(g)
`));

  test('refuses symlink inputs and preexisting private evidence destinations', () => fixture(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    root=pathlib.Path(temporary).resolve();root.chmod(0o700)
    source=root/'source';source.write_text('data');source.chmod(0o600)
    link=root/'link';link.symlink_to(source)
    denied(lambda:m.read_regular(link),'UNSAFE_PATH')
    folder=root/'folder';folder.mkdir();alias=root/'alias';alias.symlink_to(folder,target_is_directory=True)
    denied(lambda:m.real_path(alias,directory=True),'UNSAFE_PATH')
    target=root/'guard-attestation.json';m.write_new(target,{'a':1})
    assert target.read_bytes()==b'{"a":1}' and target.stat().st_mode&0o777==0o600
    try:m.write_new(target,{'a':2})
    except FileExistsError:pass
    else:raise AssertionError('overwrote existing evidence')
    assert target.read_bytes()==b'{"a":1}'
`));

  test('configured effects refuse and dotenv cannot reopen boundary or rewrite global files', () => fixture(String.raw`
m.validate_native_config({'context':{'engine':'compressor'},'hooks':{},'approvals':{'mode':'manual'}})
for config in [{'context':{'engine':'plugin'}},{'hooks':{'pre_tool_call':['shell']}},{'approvals':{'mode':'off'}},{'secrets':{'b':{'enabled':True}}}]:
    denied(lambda:m.validate_native_config(config))
def original(**kwargs):
    os.environ.update(HERMES_SAFE_MODE='0',HERMES_KANBAN_TASK='other',HERMES_YOLO_MODE='1',HERMES_HOME='/wrong',TERMINAL_CWD='/wrong')
    return ['loaded']
cfg=types.SimpleNamespace();env=types.SimpleNamespace(load_hermes_dotenv=original)
with mock.patch.dict(os.environ,{'HERMES_HOME':'/original'},clear=True):
    m.protect_bootstrap(cfg,env,pathlib.Path('/selected'))
    assert env.load_hermes_dotenv()==['loaded']
    assert os.environ['HERMES_SAFE_MODE']=='1' and os.environ['HERMES_HOME']=='/original' and os.environ['TERMINAL_CWD']=='/selected'
    assert 'HERMES_KANBAN_TASK' not in os.environ and 'HERMES_YOLO_MODE' not in os.environ
    env._sanitize_env_file_if_needed('/never-open');env._apply_external_secret_sources('/never-open');cfg.ensure_hermes_home()
    denied(lambda:cfg._warn_config_parse_failure('private'),'UNSUPPORTED_NATIVE_CONFIG')
`));

  test('native DB independently binds actual calls, results, fresh session and final artifact', () => fixture(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    path=pathlib.Path(temporary).resolve()/'state.db';g=m.SourceGuard(job());g.batch([call()]);f=final(g)
    db=sqlite3.connect(path);path.chmod(0o600)
    db.executescript('CREATE TABLE sessions(id TEXT,ended_at REAL);CREATE TABLE messages(id INTEGER,session_id TEXT,role TEXT,content TEXT,tool_call_id TEXT,tool_calls TEXT,tool_name TEXT);')
    db.execute('INSERT INTO sessions VALUES(?,?)',('fresh',1))
    calls=json.dumps([{'id':'read-1','type':'function','function':{'name':m.TOOL,'arguments':'{}'}}])
    db.executemany('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',[(1,'fresh','assistant',None,None,calls,None),(2,'fresh','tool',g.result,'read-1',None,m.TOOL),(3,'fresh','assistant',json.dumps(f),None,None,None)]);db.commit()
    proof=m.verify_native_db(path,'fresh',g,f)
    assert proof['read_calls'][0]['call_message_id']==1 and proof['read_calls'][0]['result_message_id']==2 and proof['final_message_id']==3
    assert proof['final_sha256']==m.digest(m.canonical(f))
    for sql,args in [('UPDATE messages SET content=? WHERE id=2',('forged',)),('UPDATE messages SET tool_name=? WHERE id=2',('read_file',)),('UPDATE sessions SET ended_at=NULL',())]:
        db.execute('SAVEPOINT test');db.execute(sql,args);db.commit()
        denied(lambda:m.verify_native_db(path,'fresh',g,f),'NATIVE_PROOF_MISMATCH')
        if 'content' in sql:db.execute('UPDATE messages SET content=? WHERE id=2',(g.result,))
        elif 'tool_name' in sql:db.execute('UPDATE messages SET tool_name=? WHERE id=2',(m.TOOL,))
        else:db.execute('UPDATE sessions SET ended_at=1')
        db.commit()
    db.execute('INSERT INTO sessions VALUES(?,?)',('old-session',1));db.commit()
    denied(lambda:m.verify_native_db(path,'fresh',g,f),'NATIVE_PROOF_MISMATCH');db.close()
`));

  test('pins dirty selected snapshot and refuses every changed source/diff/commit or untracked module', () => fixture(String.raw`
pin=m.strict_json(pathlib.Path(sys.argv[1]).with_name('mission-work-hermes-runtime.json').read_bytes());m.validate_pin(pin)
with tempfile.TemporaryDirectory() as temporary:
    root=pathlib.Path(temporary).resolve()
    files={name:b'fixture native source' for name in m.CRITICAL_FILES}
    for name,data in files.items():p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    diff=b'selected dirty diff';selected={'commit':'a'*40,'tracked_diff_sha256':m.digest(diff),'files':{name:m.digest(data) for name,data in files.items()}}
    fake={'format':'agenttool-hermes-runtime-pin/v1',**selected,'fingerprint':m.digest(m.canonical(selected))}
    def git(_root,*args):
        return (('a'*40+'\n').encode() if args[0]=='rev-parse' else diff if args[0]=='diff' else b'')
    with mock.patch.object(m,'git_read',side_effect=git):
        assert m.verify_runtime(root,fake)['runtime_dirty'] is True
        p=root/m.CRITICAL_FILES[0];p.write_bytes(b'changed');denied(lambda:m.verify_runtime(root,fake),'RUNTIME_DRIFT');p.write_bytes(files[m.CRITICAL_FILES[0]])
        for phase in ['rev-parse','diff','ls-files']:
            def changed(_root,*args):return b'changed' if args[0]==phase else git(_root,*args)
            with mock.patch.object(m,'git_read',side_effect=changed):denied(lambda:m.verify_runtime(root,fake),'RUNTIME_DRIFT')
    bad=dict(fake);bad['fingerprint']='sha256:'+'0'*64;denied(lambda:m.validate_pin(bad),'RUNTIME_PIN_INVALID')
`));

  test('CLI failures expose only a bounded fixed code', () => {
    const out = spawnSync(python, ['-I', '-B', runner], { input: '{"private":"CREDENTIAL_DO_NOT_PRINT"}', encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } });
    expect(out.status).toBe(1);
    expect(out.stderr).toBe('');
    expect(JSON.parse(out.stdout)).toEqual({ format: 'agenttool-hermes-source-result/v1', status: 'failed', code: 'INVALID_JOB' });
    expect(out.stdout).not.toContain('CREDENTIAL');
  });

  test('shared compatibility manifest is closed and has the expected critical seams', () => {
    const pin = JSON.parse(readFileSync(manifest, 'utf8'));
    expect(pin.format).toBe('agenttool-hermes-runtime-pin/v1');
    expect(Object.keys(pin.files)).toContain('agent/conversation_loop.py');
    expect(Object.keys(pin.files)).toContain('hermes_cli/env_loader.py');
    expect(pin.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(pin.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
