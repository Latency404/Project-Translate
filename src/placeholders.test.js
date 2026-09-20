// Platzhalter-Erkennung und -Vergleich (src/placeholders.js).
const test = require('node:test')
const assert = require('node:assert/strict')

test('placeholders', async (t) => {
  const { splitByPlaceholders, comparePlaceholders, describePlaceholder, placeholderSources } = await import('./placeholders.js')

  await t.test('splitByPlaceholders zerlegt Text und Tokens', () => {
    assert.deepEqual(splitByPlaceholders('Hit %1 for <RGB:1,0,0>10<RGB:1,1,1> {0}'), [
      { text: 'Hit ', token: false },
      { text: '%1', token: true },
      { text: ' for ', token: false },
      { text: '<RGB:1,0,0>', token: true },
      { text: '10', token: false },
      { text: '<RGB:1,1,1>', token: true },
      { text: ' ', token: false },
      { text: '{0}', token: true }
    ])
    assert.deepEqual(splitByPlaceholders('Nur Text'), [{ text: 'Nur Text', token: false }])
    assert.deepEqual(splitByPlaceholders(null), [])
  })

  await t.test('Vergleich: Reihenfolge egal, fehlend und zu viel werden gemeldet', () => {
    assert.deepEqual(comparePlaceholders('%1 hits %2', '%2 trifft %1'), { missing: [], extra: [] })
    assert.deepEqual(comparePlaceholders('Deals %1 damage', 'Verursacht Schaden'), { missing: ['%1'], extra: [] })
    assert.deepEqual(comparePlaceholders('Deals damage', 'Verursacht %3 Schaden'), { missing: [], extra: ['%3'] })
    // Anzahl zählt: zweimal im Original, einmal in der Übersetzung.
    assert.deepEqual(comparePlaceholders('%1 and %1', '%1 und'), { missing: ['%1'], extra: [] })
    // Zeilenumbrüche/Leerzeichen-Tags weichen legitim ab und werden nicht verglichen.
    assert.deepEqual(comparePlaceholders('Line<LINE>Two', 'ZeileZwei'), { missing: [], extra: [] })
    assert.deepEqual(comparePlaceholders('A <LINE> B', 'A <LINE> <LINE> B'), { missing: [], extra: [] })
    // Farb-/Größen-Tags dagegen schon.
    assert.deepEqual(comparePlaceholders('<RGB:1,0,0>Hot', 'Heiß'), { missing: ['<RGB:1,0,0>'], extra: [] })
  })

  await t.test('Prozentzeichen im normalen Text ist kein Platzhalter', () => {
    assert.deepEqual(comparePlaceholders('100% sure', '100% sicher'), { missing: [], extra: [] })
    assert.deepEqual(splitByPlaceholders('50 % done'), [{ text: '50 % done', token: false }])
  })

  await t.test('describePlaceholder erklärt in einfachen Worten', () => {
    assert.match(describePlaceholder('%1'), /value the game fills in/)
    assert.match(describePlaceholder('{0}'), /value the game fills in/)
    assert.equal(describePlaceholder('<LINE>'), 'a line break')
    assert.equal(describePlaceholder('<RGB:1,1,1>'), 'a text color')
    assert.equal(describePlaceholder('<FOO>'), 'a formatting code')
  })

  await t.test('placeholderSources ordnet %N dem N-ten getText-Argument zu', () => {
    const usage = [{ file: 'UB.lua', args: ['ub_barrel.altLabel', 'count'], resolved: ['Translator.getName(name)', null] }]
    assert.deepEqual(placeholderSources('Unscrew %1 x%2 %1', usage), {
      '%1': { expr: 'ub_barrel.altLabel', value: 'Translator.getName(name)', file: 'UB.lua' },
      '%2': { expr: 'count', value: 'count', file: 'UB.lua' }
    })
    assert.deepEqual(placeholderSources('Unscrew %3', usage), {})
    assert.deepEqual(placeholderSources('Unscrew %1', undefined), {})
  })
})
