import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveReleaseVersion} from '../tools/release_version.mjs';
test('tag-triggered releases derive the version without workflow_dispatch inputs', () => {
  assert.equal(resolveReleaseVersion({refType:'tag',refName:'v1.2.3'}),'1.2.3');
  assert.equal(resolveReleaseVersion({refType:'tag',refName:'v1.2.3-beta.1',requestedVersion:''}),'1.2.3-beta.1');
});
test('manual releases keep explicit version, and tags may not disagree with the input', () => {
  assert.equal(resolveReleaseVersion({refType:'branch',requestedVersion:'1.2.3'}),'1.2.3');
  assert.throws(() => resolveReleaseVersion({refType:'tag',refName:'v1.2.3',requestedVersion:'2.0.0'}));
});
test('malformed versions cannot become release tags or shell arguments', () => {
  for (const value of ['', '01.2.3', 'v1.2.3', '1.2.3+private', '1.2.3-01', '1.2.3;echo', '1.2.3-', '1.2.3\n'])
    assert.throws(() => resolveReleaseVersion({requestedVersion:value}));
  assert.throws(() => resolveReleaseVersion({refType:'tag',refName:'release-1.2.3',requestedVersion:'1.2.3'}));
});
