const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require('discord.js');

const source = fs.readFileSync(
  path.join(__dirname, 'index.js'),
  'utf8'
);
const helperStart = source.indexOf('function createStringSelector(');
const helperEnd = source.indexOf(
  'const stratagemDifficultyPoints =',
  helperStart
);

assert.notEqual(helperStart, -1, 'Could not find production modal helpers.');
assert.notEqual(helperEnd, -1, 'Could not find the production helper boundary.');

const context = vm.createContext({
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  operations: ['Inferno', 'Other / Not Listed'],
  pendingDifficultySelections: new Map(),
  operationsDifficultyWorkflowLifetimeMs: 10 * 60 * 1000,
  setTimeout,
  clearTimeout
});

vm.runInContext(source.slice(helperStart, helperEnd), context);

const modal = vm.runInContext(
  'createOperationsModal().toJSON()',
  context
);
assert.equal(modal.custom_id, 'aar_operations_submit');
assert.equal(modal.components.length, 5);

const fields = modal.components.map(field => ({
  label: field.label,
  component: field.component
}));
assert.deepEqual(
  fields.map(field => field.label),
  [
    'Select Operation',
    'Gene Seed',
    'Armoury Data',
    'Pack Members',
    'Evidence Files'
  ]
);
assert.deepEqual(
  fields.map(field => field.component.custom_id),
  [
    'aar_operation',
    'aar_gene_seed',
    'aar_armoury_data',
    'aar_squad',
    'aar_evidence'
  ]
);
assert.deepEqual(
  fields[0].component.options.map(option => option.value),
  ['Inferno', 'Other / Not Listed']
);
assert.deepEqual(
  fields[1].component.options.map(option => option.value),
  ['Yes', 'No']
);
assert.deepEqual(
  fields[2].component.options.map(option => option.value),
  ['0', '1', '2', '3']
);
assert.equal(fields[3].component.min_values, 0);
assert.equal(fields[3].component.max_values, 2);
assert.equal(fields[4].component.min_values, 1);
assert.equal(fields[4].component.max_values, 6);
console.log('Operations modal order and all five field constraints verified.');

const difficultyValues = {
  Average: 1,
  Substantial: 2,
  Ruthless: 3,
  Lethal: 4,
  Absolute: 5
};
assert.deepEqual(
  Object.fromEntries(
    [...source.matchAll(/'([^']+)': ([1-5]),?/g)]
      .map(match => [match[1], Number(match[2])])
      .filter(([name]) => Object.hasOwn(difficultyValues, name))
  ),
  difficultyValues
);
console.log('Existing Operations difficulty base-point values verified.');

const difficultyHandlerStart = source.indexOf(
  "interaction.customId === 'aar_difficulty_select'"
);
const difficultyHandlerEnd = source.indexOf(
  "interaction.customId === 'aar_stratagems_difficulty_select'",
  difficultyHandlerStart
);
const difficultyHandler = source.slice(
  difficultyHandlerStart,
  difficultyHandlerEnd
);
assert.match(difficultyHandler, /pendingDifficultySelections\.set/);
assert.match(difficultyHandler, /scheduleOperationsWorkflowExpiration/);
assert.match(
  difficultyHandler,
  /await interaction\.showModal\(createOperationsModal\(\)\)/
);
assert.doesNotMatch(difficultyHandler, /interaction\.reply|createOperationsSquadPicker/);
console.log('Difficulty selection preserves expiry and opens the modal immediately.');

const submitHandlerStart = source.indexOf(
  "interaction.customId === 'aar_operations_submit'"
);
const submitHandlerEnd = source.indexOf(
  '// STRATAGEMS FORM SUBMISSION',
  submitHandlerStart
);
const submitHandler = source.slice(submitHandlerStart, submitHandlerEnd);
assert.match(
  submitHandler,
  /getSelectedUsers\('aar_squad'\)/
);
assert.match(
  submitHandler,
  /selectedUserIds\.length > 2/
);
assert.match(
  submitHandler,
  /\.filter\(userId => userId !== interaction\.user\.id\)/
);
assert.match(
  submitHandler,
  /buildOperationsParticipants\(\s*interaction\.user\.id,\s*selectedTeammateIds/
);
assert.match(
  submitHandler,
  /for \(const userId of participants\) \{\s*insertParticipant\.run\(\s*reportId,\s*userId/
);
console.log('Modal selections feed the existing Operations participant and database path.');

assert.doesNotMatch(source, /aar_ops_squad_(?:search|toggle|page|confirm|cancel)/);
assert.doesNotMatch(source, /pendingOperationsSquadPickers|operationsSquadPicker/);

const participants = [
  ...context.buildOperationsParticipants('submitter-1', ['member-1', 'member-2'])
];
assert.deepEqual(participants, ['submitter-1', 'member-1', 'member-2']);
assert.equal(new Set(participants).size, participants.length);
assert.throws(
  () => context.buildOperationsParticipants('submitter-1', ['submitter-1']),
  /Invalid Operations squad member selection/
);
assert.throws(
  () => context.buildOperationsParticipants('submitter-1', ['member-1', 'member-1']),
  /Invalid Operations squad member selection/
);
assert.throws(
  () => context.buildOperationsParticipants('submitter-1', ['one', 'two', 'three']),
  /Invalid Operations squad member selection/
);
console.log('Participant limit, uniqueness, and automatic submitter inclusion verified.');
