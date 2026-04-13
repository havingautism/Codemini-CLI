import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommandRisk, requiresApprovalEvaluation } from '../src/core/command-risk.js';

describe('classifyCommandRisk', () => {
  it('classifies ls as read-only', () => {
    assert.equal(classifyCommandRisk('ls -la'), 'read-only');
  });

  it('classifies git status as read-only', () => {
    assert.equal(classifyCommandRisk('git status'), 'read-only');
  });

  it('classifies git log as read-only', () => {
    assert.equal(classifyCommandRisk('git log --oneline -10'), 'read-only');
  });

  it('classifies git diff as read-only', () => {
    assert.equal(classifyCommandRisk('git diff HEAD'), 'read-only');
  });

  it('classifies cat as read-only', () => {
    assert.equal(classifyCommandRisk('cat file.txt'), 'read-only');
  });

  it('classifies pwd as read-only', () => {
    assert.equal(classifyCommandRisk('pwd'), 'read-only');
  });

  it('classifies echo without redirect as read-only', () => {
    assert.equal(classifyCommandRisk('echo "hello"'), 'read-only');
  });

  it('classifies node --version as read-only', () => {
    assert.equal(classifyCommandRisk('node --version'), 'read-only');
  });

  it('classifies npm --version as read-only', () => {
    assert.equal(classifyCommandRisk('npm --version'), 'read-only');
  });

  it('classifies npm view as read-only', () => {
    assert.equal(classifyCommandRisk('npm view lodash version'), 'read-only');
  });

  it('classifies npm install as write-high-risk', () => {
    assert.equal(classifyCommandRisk('npm install lodash'), 'write-high-risk');
  });

  it('classifies npm install -g as write-high-risk', () => {
    assert.equal(classifyCommandRisk('npm install -g typescript'), 'write-high-risk');
  });

  it('classifies pip install as write-high-risk', () => {
    assert.equal(classifyCommandRisk('pip install requests'), 'write-high-risk');
  });

  it('classifies git push as write-high-risk', () => {
    assert.equal(classifyCommandRisk('git push origin main'), 'write-high-risk');
  });

  it('classifies git commit as write-high-risk', () => {
    assert.equal(classifyCommandRisk('git commit -m "fix"'), 'write-high-risk');
  });

  it('classifies mkdir as write-high-risk', () => {
    assert.equal(classifyCommandRisk('mkdir new-folder'), 'write-high-risk');
  });

  it('classifies echo with redirect as write-high-risk', () => {
    assert.equal(classifyCommandRisk('echo "hello" > file.txt'), 'write-high-risk');
  });

  it('classifies echo with append redirect as write-high-risk', () => {
    assert.equal(classifyCommandRisk('echo "hello" >> file.txt'), 'write-high-risk');
  });

  it('classifies curl POST as write-high-risk', () => {
    assert.equal(classifyCommandRisk('curl -X POST http://example.com'), 'write-high-risk');
  });

  it('classifies sudo as write-high-risk', () => {
    assert.equal(classifyCommandRisk('sudo apt update'), 'write-high-risk');
  });

  it('classifies cp as write-high-risk', () => {
    assert.equal(classifyCommandRisk('cp a.txt b.txt'), 'write-high-risk');
  });

  it('classifies mv as write-high-risk', () => {
    assert.equal(classifyCommandRisk('mv a.txt b.txt'), 'write-high-risk');
  });

  it('classifies python script.py as ambiguous', () => {
    assert.equal(classifyCommandRisk('python script.py'), 'ambiguous');
  });

  it('classifies unknown command as ambiguous', () => {
    assert.equal(classifyCommandRisk('my-custom-tool --flag'), 'ambiguous');
  });

  it('classifies chained command with write segment as write-high-risk', () => {
    assert.equal(classifyCommandRisk('ls && rm file.txt'), 'write-high-risk');
  });

  it('classifies chained read-only commands as read-only', () => {
    assert.equal(classifyCommandRisk('ls && pwd'), 'read-only');
  });

  it('classifies piped read-only commands as read-only', () => {
    assert.equal(classifyCommandRisk('ls | grep foo'), 'read-only');
  });

  it('classifies piped read-only commands with multiple pipes as read-only', () => {
    assert.equal(classifyCommandRisk('cat file.txt | grep foo | wc -l'), 'read-only');
  });

  it('classifies piped command with write as write-high-risk', () => {
    assert.equal(classifyCommandRisk('echo "data" > file.txt'), 'write-high-risk');
  });

  it('classifies empty command as read-only', () => {
    assert.equal(classifyCommandRisk(''), 'read-only');
  });

  it('classifies npm run build as read-only (npm run is in read-only subcmds)', () => {
    assert.equal(classifyCommandRisk('npm run build'), 'read-only');
  });

  it('classifies docker rm as write-high-risk', () => {
    assert.equal(classifyCommandRisk('docker rm container_id'), 'write-high-risk');
  });

  it('classifies touch as write-high-risk', () => {
    assert.equal(classifyCommandRisk('touch newfile.txt'), 'write-high-risk');
  });
});

describe('requiresApprovalEvaluation', () => {
  it('returns false for read-only commands', () => {
    assert.equal(requiresApprovalEvaluation('ls -la'), false);
    assert.equal(requiresApprovalEvaluation('git status'), false);
    assert.equal(requiresApprovalEvaluation('cat README.md'), false);
  });

  it('returns true for write/high-risk commands', () => {
    assert.equal(requiresApprovalEvaluation('npm install lodash'), true);
    assert.equal(requiresApprovalEvaluation('git push'), true);
    assert.equal(requiresApprovalEvaluation('mkdir test'), true);
  });

  it('returns true for ambiguous commands', () => {
    assert.equal(requiresApprovalEvaluation('python script.py'), true);
  });
});
