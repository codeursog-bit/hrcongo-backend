require('ts-node').register({ transpileOnly: true });
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { HELP, answerHelp, numbersGrounded } = require('../src/assistant/help');
const questions = require('../test/assistant/questions.json');
for (const q of questions) {
  const answer = answerHelp(q.message, q.role);
  if (q.refusal) assert.equal(answer.refusal, true, q.message);
  else {
    assert.equal(answer.article?.id, q.article, q.role + ': ' + q.message);
    assert.equal(answer.text, HELP.find((a) => a.id === q.article).text);
    assert.ok(numbersGrounded(answer.text, answer.article));
  }
}
assert.ok(questions.length >= 80 && questions.length <= 100);
for (const article of HELP) {
  assert.ok(
    fs.existsSync(
      path.resolve(
        __dirname,
        '../../frontend/app/(dashboard)',
        article.path.slice(1),
        'page.tsx',
      ),
    ),
    article.path,
  );
  assert.ok(!/\d/.test(article.text), 'help must not invent numerical facts');
}
for (const name of ['knowledge.json', 'help.ts'])
  assert.equal(
    fs.readFileSync(path.join(__dirname, '../src/assistant', name), 'utf8'),
    fs.readFileSync(
      path.join(__dirname, '../../frontend/lib/assistant', name),
      'utf8',
    ),
    'demo and server knowledge must stay aligned',
  );
for (const name of [
  'assistant.service.ts',
  'assistant.controller.ts',
  'help.ts',
]) {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/assistant', name),
    'utf8',
  );
  assert.ok(
    !/\bfetch\(|\baxios\b|from ['"](?:https?|@openai|@google|@mistral|openai|anthropic)/.test(
      source,
    ),
    'no model network code in integrated help',
  );
}
console.log(
  `PASS: ${questions.length} questions de référence, exactitude des textes, refus, rôles, routes d’aide et parité démo/back ; aucun adaptateur externe.`,
);
