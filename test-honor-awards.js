'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const honorRows = [
  ['honor_1', 'Conversion Ward', 1, 'assets/honors/Conversion ward.png'],
  ['honor_2', 'Rune', 2, 'assets/honors/Rune.png'],
  ['honor_3', 'Gem', 3, 'assets/honors/Gem.png'],
  ['honor_4', 'Fang Necklace', 4, 'assets/honors/Fang Necklace.png'],
  ['honor_5', 'Talisman', 5, 'assets/honors/Talisman.png'],
  ['honor_6', 'Crux Terminatus', 6, 'assets/honors/Crux Terminatus.png']
].map(([honor_id, display_name, display_order, icon_path]) => ({
  honor_id, display_name, display_order, icon_path
}));

const awards = [];
const settings = new Map();
let nextAwardId = 1;
let fakeNow = 1;

function getHonor(honorId) {
  return honorRows.find(row => row.honor_id === honorId) || null;
}

function activeAwards(guildId, userId, honorId) {
  return awards.filter(row => row.guild_id === guildId && row.user_id === userId &&
    (!honorId || row.honor_id === honorId) && row.is_active === 1);
}

async function execute(sqlOrConfig, args = []) {
  const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.sql;
  args = typeof sqlOrConfig === 'string' ? args : (sqlOrConfig.args || []);
  const normalized = sql.replace(/\\s+/g, ' ').trim().toLowerCase();

  if (normalized.includes('select honor_id, display_name, display_order, icon_path from honors where honor_id =')) {
    const row = getHonor(args[0]);
    return { rows: row ? [{ ...row }] : [] };
  }
  if (normalized.includes('select layout_mode from honor_settings where guild_id =')) {
    const mode = settings.get(args[0]);
    return { rows: mode ? [{ layout_mode: mode }] : [] };
  }
  if (normalized.includes('insert into honor_awards')) {
    awards.push({
      id: nextAwardId++, guild_id: args[0], user_id: args[1], honor_id: args[2],
      awarded_by: args[3], awarded_at: String(fakeNow++).padStart(6, '0'),
      is_active: 1, removed_by: null, removed_at: null
    });
    return { rows: [] };
  }
  if (normalized.includes('select count(*) as count from honor_awards')) {
    return { rows: [{ count: activeAwards(args[0], args[1], args[2]).length }] };
  }
  if (normalized.includes('group by h.honor_id, h.display_name, h.display_order, h.icon_path')) {
    const guildId = args[0], userId = args[1];
    const groups = new Map();
    for (const award of activeAwards(guildId, userId)) {
      const honor = getHonor(award.honor_id);
      if (!honor) continue;
      if (!groups.has(honor.honor_id)) groups.set(honor.honor_id, { ...honor, count: 0, first_awarded_at: award.awarded_at });
      const group = groups.get(honor.honor_id);
      group.count++;
      if (award.awarded_at < group.first_awarded_at) group.first_awarded_at = award.awarded_at;
    }
    const rows = [...groups.values()];
    if (normalized.includes('order by h.display_order asc')) rows.sort((a,b)=>a.display_order-b.display_order);
    else rows.sort((a,b)=>a.first_awarded_at.localeCompare(b.first_awarded_at));
    return { rows };
  }
  if (normalized.includes('select id from honor_awards') && normalized.includes('is_active = 1')) {
    const row = activeAwards(args[0], args[1], args[2]).sort((a,b)=>a.awarded_at.localeCompare(b.awarded_at)||a.id-b.id)[0];
    return { rows: row ? [{ id: row.id }] : [] };
  }
  if (normalized.includes('update honor_awards set is_active = 0')) {
    const row = awards.find(a => a.id === args[1] && a.is_active === 1);
    if (row) { row.is_active = 0; row.removed_by = args[0]; row.removed_at = 'removed'; }
    return { rows: [] };
  }
  if (normalized.includes('select ha.id, ha.honor_id, h.display_name, h.icon_path')) {
    const rows = awards.filter(a=>a.guild_id===args[0]&&a.user_id===args[1]).map(a=>{
      const honor=getHonor(a.honor_id);
      return {...a, display_name:honor?.display_name, icon_path:honor?.icon_path};
    }).sort((a,b)=>b.awarded_at.localeCompare(a.awarded_at)||b.id-a.id);
    return { rows };
  }
  if (normalized.includes('update honors set display_name =')) {
    const row = getHonor(args[1]);
    if (row) row.display_name=args[0];
    return { rows: [] };
  }
  if (normalized.includes('insert into honor_settings')) {
    settings.set(args[0], args[1]);
    return { rows: [] };
  }
  if (normalized.includes('select honor_id, display_name, display_order, icon_path from honors order by display_order asc')) {
    return { rows: honorRows.map(row=>({...row})).sort((a,b)=>a.display_order-b.display_order) };
  }
  if (normalized.includes('select honor_id from honors where honor_id =')) {
    return { rows: getHonor(args[0]) ? [{ honor_id: args[0] }] : [] };
  }
  throw new Error('Unimplemented mock SQL: ' + sql);
}

const mockDb = {
  execute,
  async withTransaction(callback) {
    return callback({ execute });
  }
};

const source = fs.readFileSync(path.join(__dirname, 'honor.js'), 'utf8');
const moduleStub = { exports: {} };
const sandbox = {
  module: moduleStub,
  exports: moduleStub.exports,
  require(name) {
    if (name === './turso-database') return mockDb;
    throw new Error('Unexpected require: ' + name);
  },
  console
};
vm.runInNewContext(source, sandbox, { filename: 'honor.js' });
const honor = moduleStub.exports;

async function main() {
  const guild='guild-test', user='member-test', mod='mod-test';

  for (let i=1;i<=3;i++) {
    const result=await honor.awardHonor(guild,user,'honor_2',mod);
    assert.equal(result.success,true,'award should succeed');
    assert.equal(result.count,i,'award count should increment for each copy');
  }
  let grouped=await honor.getMemberHonors(guild,user);
  assert.equal(grouped.length,1,'same Honor should group into one entry');
  assert.equal(grouped[0].count,3,'grouped result should report three copies');

  let layout=await honor.getHonorDisplayLayout(guild,user);
  assert.equal(layout.layoutMode,'fixed');
  assert.equal(layout.leftColumn[1].honor_id,'honor_2','fixed layout should keep Honor in its slot');
  assert.equal(layout.leftColumn[1].count,3,'fixed card should carry count');
  assert.equal(layout.rightColumn[0],null);

  const removed=await honor.removeHonor(guild,user,'honor_2',mod);
  assert.equal(removed.success,true,'one copy should be revocable');
  grouped=await honor.getMemberHonors(guild,user);
  assert.equal(grouped[0].count,2,'revocation should reduce active copies by exactly one');
  const history=await honor.getMemberHonorHistory(guild,user);
  assert.equal(history.length,3,'history should retain all three award records');
  assert.equal(history.filter(row=>row.is_active===1).length,2,'history should show two active copies');

  const reaward=await honor.awardHonor(guild,user,'honor_2',mod);
  assert.equal(reaward.count,3,'re-award should restore active count without erasing history');

  await honor.renameHonor('honor_2','Runebearer Mark');
  const renamed=await honor.getHonorById('honor_2');
  assert.equal(renamed.display_name,'Runebearer Mark','rename should update display name');
  assert.equal(renamed.icon_path,'assets/honors/Rune.png','rename must preserve icon mapping');
  layout=await honor.getHonorDisplayLayout(guild,user);
  assert.equal(layout.leftColumn[1].honor_id,'honor_2','rename must preserve permanent slot/id');

  await honor.setHonorLayout(guild,'sequential');
  await honor.awardHonor(guild,user,'honor_3',mod);
  await honor.awardHonor(guild,user,'honor_3',mod);
  await honor.awardHonor(guild,user,'honor_1',mod);
  layout=await honor.getHonorDisplayLayout(guild,user);
  assert.equal(layout.layoutMode,'sequential');
  assert.equal(layout.leftColumn[0].honor_id,'honor_2','sequential order should be based on first-earned Honors');
  assert.equal(layout.leftColumn[0].count,3,'sequential mode groups repeated copies');
  assert.equal(layout.leftColumn[1].honor_id,'honor_3','second distinct Honor should occupy next slot');
  assert.equal(layout.leftColumn[1].count,2);
  assert.equal(layout.leftColumn[2].honor_id,'honor_1','third distinct Honor should occupy next slot');

  console.log('Honor award logic regression tests passed: repeat awards, counts, one-copy revoke, retained history, rename, fixed and sequential layout.');
  console.log('Discord connection: none. Real database: none. Live data: none.');
}

main().catch(error=>{console.error('Honor award logic test failed:',error);process.exitCode=1;});
