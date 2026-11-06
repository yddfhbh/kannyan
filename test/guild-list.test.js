import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuildListEmbeds, validateGuildListEmbeds } from '../src/guild-list.js';

function makeState(activeCount, leftCount = 0) {
  const guilds = {};
  for (let index = 0; index < activeCount + leftCount; index += 1) {
    const active = index < activeCount;
    const id = `guild-${index}`;
    guilds[id] = {
      name: active ? `참가 *서버* ${index} 🐈` : `탈퇴 [서버] ${index}`,
      memberCount: index % 7 === 0 ? null : index * 3,
      status: active ? 'active' : 'left',
    };
  }
  return { guilds };
}

function embedText(embed) {
  const json = embed.toJSON();
  return [json.title, json.description, json.footer?.text,
    ...(json.fields ?? []).flatMap((field) => [field.name, field.value])]
    .filter(Boolean).join('');
}

test('35 active and 12 left records are all represented without duplicate or missing IDs', () => {
  const state = makeState(35, 12);
  const embeds = buildGuildListEmbeds(state, new Date('2026-11-06T00:00:00.000Z'));
  const ids = embeds.flatMap((embed) => embed.toJSON().fields ?? [])
    .map((field) => field.value.match(/\*\*서버 ID:\*\* `([^`]+)`/)?.[1])
    .filter(Boolean);

  assert.equal(ids.length, 47);
  assert.equal(new Set(ids).size, 47);
  assert.equal(validateGuildListEmbeds(embeds), true);
  assert.equal(embeds.filter((embed) => embed.toJSON().title.startsWith('참가 서버')).length > 0, true);
  assert.equal(embeds.filter((embed) => embed.toJSON().title.startsWith('탈퇴 서버')).length > 0, true);
});

for (const count of [50, 100, 200]) {
  test(`${count} records are dynamically paginated within embed limits`, () => {
    const embeds = buildGuildListEmbeds(makeState(count), new Date());
    const fields = embeds.reduce((sum, embed) => sum + (embed.toJSON().fields ?? [])
      .filter((field) => field.value.includes('**서버 ID:**')).length, 0);
    assert.equal(fields, count);
    assert.ok(embeds.length > 1);
    assert.equal(validateGuildListEmbeds(embeds), true);
    for (const embed of embeds) {
      const json = embed.toJSON();
      assert.ok((json.fields?.length ?? 0) <= 25);
      assert.ok(embedText(embed).length <= 5800);
      assert.ok((json.fields ?? []).every((field) => field.value.length <= 1024));
    }
  });
}

test('unknown member counts remain unknown and names are markdown-safe', () => {
  const embed = buildGuildListEmbeds(makeState(1), new Date())[0].toJSON();
  assert.match(embed.fields[0].value, /멤버 수:\*\* 확인 불가/);
  assert.match(embed.fields[0].value, /참가 \\\*서버\\\*/);
});
