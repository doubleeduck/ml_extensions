import {spawnSync} from 'node:child_process';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createPrivateKey,randomUUID} from 'node:crypto';
import path from 'node:path';
import {resolveReleaseVersion} from './release_version.mjs';
const version = resolveReleaseVersion({requestedVersion:process.env.RELEASE_VERSION,
  refType:process.env.GITHUB_REF_TYPE,refName:process.env.GITHUB_REF_NAME});
const commit = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/u.test(commit ?? '')) throw Error('A valid workflow commit SHA is required.');
const run = (command,args,options = {}) => {
  const result = spawnSync(command,args,{stdio:'inherit',...options}); if (result.status !== 0) throw Error('Release command failed.'); return result;
};
const tag = `v${version}`, tagCommit = spawnSync('git',['rev-list','-n','1',tag],{encoding:'utf8'});
if (tagCommit.status !== 0 || tagCommit.stdout.trim() !== commit) throw Error('The existing release tag must point at the workflow commit.');
if (process.argv.includes('--publish')) {
  const file = 'dist/official.mangalaunch.sources.mlsource';
  for (const suffix of ['', '.public.json','.sha256']) await readFile(`${file}${suffix}`);
  for (const name of ['extensions-index.json','extensions-index.ed25519']) await readFile(`dist/${name}`);
  run('gh',['release','create',tag,'--verify-tag','--title',`Official sources ${version}`,'--notes','Signed handwritten JS source package. All rights reserved.',
    file,`${file}.public.json`,`${file}.sha256`,'dist/extensions-index.json','dist/extensions-index.ed25519',...(version.includes('-') ? ['--prerelease'] : [])]);
} else {
  const keyId = process.env.MLSOURCE_PUBLISHER_KEY_ID, encoded = process.env.MLSOURCE_SIGNING_KEY_BASE64;
  if (!keyId || !/^[A-Za-z0-9._-]{1,128}$/u.test(keyId) || !encoded || !/^[A-Za-z0-9+/=]+$/u.test(encoded) || encoded.length > 16384) throw Error('Configure the protected publisher signing secret/key ID.');
  const key = Buffer.from(encoded,'base64'); if (createPrivateKey(key).asymmetricKeyType !== 'ed25519') throw Error('Release key must be Ed25519.');
  const temporary = process.env.RUNNER_TEMP; if (!temporary || !path.isAbsolute(temporary)) throw Error('A runner-owned temporary directory is required.');
  const file = path.join(temporary,`mlsource-signing-${randomUUID()}.pem`);
  const childEnv = {...process.env}; delete childEnv.MLSOURCE_SIGNING_KEY_BASE64;
  try {
    await writeFile(file,key,{flag:'wx',mode:0o600});
    run(process.execPath,['tools/pack.mjs','--key',file,'--key-id',keyId,'--version',version],{env:childEnv});
    const serial = Number(process.env.GITHUB_RUN_NUMBER)*100+Number(process.env.GITHUB_RUN_ATTEMPT ?? '1');
    run(process.execPath,['tools/sign_repository_index.mjs','--repo',process.env.GITHUB_REPOSITORY,
      '--serial',String(serial),'--tag',tag,'--package','dist/official.mangalaunch.sources.mlsource','--key',file],{env:childEnv});
  }
  finally { key.fill(0); await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
