// mod-export: installierbarer Übersetzungs-Mod — EINE mod.info im festen
// Versionsordner "42" (nicht am Mod-Root, sonst erkennt B42 den Mod nicht,
// s. ZomboidFileSystem.getAllModFoldersAux), ALLE Übersetzungen aller
// gewählten Mods gemergt in EINEN common/-Baum je Sprache (B42 lädt common/
// immer, egal welcher Versionsordner gewählt wird — TXT liest B42 nicht mehr,
// Ausgabe ist deshalb immer JSON), loadModAfter= listet die Quell-Mod-ids,
// deterministische id, nur übersetzte Einträge, sicherer Bundle-Ordnername.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, cpSync, readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { scan } = require('./scanner')
const {
  exportMod,
  exportModsBundle,
  layoutLocations,
  singleModInfoId,
  bundleModInfoId,
  sanitizeFolderName
} = require('./mod-export')
const { injectLayoutFixtures } = require('./fixtures-inject')

let workdir
let fakeRoot
let mods

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'pt-modx-'))
  fakeRoot = path.join(workdir, 'fixtures')
  cpSync(path.join(__dirname, 'fixtures'), fakeRoot, { recursive: true })
  injectLayoutFixtures(fakeRoot)
  const r = await scan(
    path.join(fakeRoot, 'gameRoot'),
    path.join(fakeRoot, 'workshop'),
    'DE'
  )
  mods = r.mods
})

after(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true })
})

test('exportMod: mod.info im festen Versionsordner "42", nur die neueste Version wird übersetzt', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const targetDir = path.join(workdir, 'export')
  const { targetPath, written, targetLangs } = exportMod(coffee, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Coffee Machines Fix-DE')
  // targetPath ist POSIX-Style (Projekt-Konvention)
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  // Ein-Sprachen-Fall: targetLangs normalisiert einen einzelnen String zum Array.
  assert.deepEqual(targetLangs, ['DE'])
  // mod.info liegt NUR im festen Versionsordner "42", nirgendwo sonst.
  assert.ok(!existsSync(path.join(outRoot, 'mod.info')))
  assert.ok(!existsSync(path.join(outRoot, '42.20', 'mod.info')))
  const infoPath = path.join(outRoot, '42', 'mod.info')
  assert.ok(existsSync(infoPath))
  const info = readFileSync(infoPath, 'utf8')
  assert.match(info, /^id=pt_2688538916_Coffee_Machines_Fix_DE$/m)
  assert.match(info, /^name=Coffee Machines Fix Translation \(DE\)$/m)
  assert.match(info, /^author=Project Translate$/m)
  assert.match(info, /^description=.+Coffee Machines Fix.+DE.*$/m)
  // Kein versionMin/versionMax nötig — "42" ist bereits ein gültiger,
  // versionsunabhängiger Versionsordner.
  assert.ok(!info.includes('versionMin'))
  assert.ok(!info.includes('versionMax'))
  assert.ok(!info.includes('game_version'))
  // loadModAfter= nennt die mod.info-id des Quell-Mods (aus dessen mod.info
  // am Mod-Root, da Coffee Machines Fix weder in common/ noch im
  // Versionsordner eine eigene mod.info hat).
  assert.match(info, /^loadModAfter=CoffeeMachinesFix$/m)

  // Übersetzte Einträge landen unter common/, nicht unter dem Versionsordner
  // der Quelle (42.20) — B42 lädt common/ immer, egal welche Version gewählt wird.
  const f42 = readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json'), 'utf8'
  )
  const f42obj = JSON.parse(f42)
  assert.equal(f42obj.ContextMenu_OPTION_COFFEE_MACHINE, 'Kaffeemaschine')
  assert.ok(!existsSync(path.join(outRoot, '42.20')))
  // Ältere Version (42) wird nicht exportiert
  assert.ok(!existsSync(path.join(outRoot, '42', 'media')))
  assert.ok(written.includes('42/mod.info'))
  assert.ok(written.includes('common/media/lua/shared/Translate/DE/ContextMenu.json'))
  assert.ok(written.length >= 3)
})

test('exportMod: icon.png liegt neben der EINEN mod.info und ist dort deklariert', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const targetDir = path.join(workdir, 'export2')
  const { written } = exportMod(belt, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Expanded Belt-DE')
  assert.ok(existsSync(path.join(outRoot, '42', 'icon.png')))
  assert.ok(!existsSync(path.join(outRoot, 'icon.png')))
  assert.ok(written.includes('42/icon.png'))
  const info = readFileSync(path.join(outRoot, '42', 'mod.info'), 'utf8')
  assert.match(info, /^poster=icon\.png$/m)
  assert.match(info, /^icon=icon\.png$/m)
})

test('exportMod: Basisspiel → mod.info im Versionsordner "42", kein loadModAfter (kein modInfoId)', () => {
  const base = mods.find((m) => m.id === 'BASE')
  const targetDir = path.join(workdir, 'export3')
  const { targetPath } = exportMod(base, 'DE', targetDir)
  assert.equal(targetPath, path.join(targetDir, 'Project Zomboid (Base Game)-DE').replace(/\\/g, '/'))
  assert.ok(!existsSync(path.join(targetPath, 'mod.info')))
  const info = readFileSync(path.join(targetPath, '42', 'mod.info'), 'utf8')
  assert.match(info, /^id=pt_BASE_DE$/m)
  assert.ok(!info.includes('game_version'))
  assert.ok(!info.includes('versionMin'))
  assert.ok(!info.includes('versionMax'))
  assert.ok(!info.includes('loadModAfter'))
  // UI.json: 2 von 4 übersetzt → nur 2 Keys; landet unter common/ (Basisspiel
  // hat keinen Versionsordner, sein Root wird intern als "base"-Ort behandelt).
  const ui = JSON.parse(readFileSync(
    path.join(targetPath, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  assert.equal(Object.keys(ui).length, 2)
  assert.equal(ui.UI_MainMenu_Play, 'Spielen')
})

test('layoutLocations: common / root / reines common / dual / base', () => {
  const base = mods.find((m) => m.id === 'BASE')
  const fn = mods.find((m) => m.id === '9999000001/Field Notes')
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  const gear = mods.find((m) => m.id === '9999000003/CommonGear')
  const dual = mods.find((m) => m.id === '9999000004/DualLayout')
  assert.ok(base && fn && radio && gear && dual, 'alle Layout-Fixtures gefunden')
  assert.deepEqual(layoutLocations(base).map((l) => l.rel), ['base'])
  assert.deepEqual(layoutLocations(fn).map((l) => l.rel), ['common'])
  assert.deepEqual(layoutLocations(radio).map((l) => l.rel), ['root'])
  assert.deepEqual(layoutLocations(gear).map((l) => l.rel), ['common'])
  assert.deepEqual(layoutLocations(dual).map((l) => l.rel), ['common', '42.20'])
  // reines common-Layout: kein Versionsordner
  assert.deepEqual(gear.versions, [])
})

test('exportMod: common-Layout mit TXT-Quelle (Lua-Translate) — Ausgabe ist trotzdem JSON unter common/', () => {
  const fn = mods.find((m) => m.id === '9999000001/Field Notes')
  const targetDir = path.join(workdir, 'export4')
  const { written } = exportMod(fn, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Field Notes-DE')
  const info = readFileSync(path.join(outRoot, '42', 'mod.info'), 'utf8')
  assert.match(info, /^name=Field Notes Translation \(DE\)$/m)
  // TXT-Quelle (Sandbox_EN.txt) → Ausgabe Sandbox.json (nicht .txt, B42 liest
  // kein Lua-Translate mehr) unter common/, unabhängig vom common-Layout der Quelle.
  const p = path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox.json')
  assert.ok(existsSync(p))
  assert.ok(!existsSync(path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox_DE.txt')))
  const obj = JSON.parse(readFileSync(p, 'utf8'))
  // Die Übersetzung kam aus der (alten) Sandbox_DE.txt der Quelle — die
  // legacy-Lesefunktion des Scanners liest sie weiterhin.
  assert.equal(obj.Sandbox_FieldNotes, 'Feldnotizen')
  // unübersetzte Keys (HowTo, TipOne) werden nicht exportiert
  assert.ok(!('Sandbox_FieldNotes_HowTo' in obj))
  assert.ok(!('Sandbox_FieldNotes_TipOne' in obj))
  assert.deepEqual(written, [
    '42/mod.info',
    'common/media/lua/shared/Translate/DE/Sandbox.json'
  ])
})

test('exportMod: root-Layout (Translate am Mod-Root, JSON) — Ausgabe landet trotzdem unter common/', () => {
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  const targetDir = path.join(workdir, 'export5')
  const { written } = exportMod(radio, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Radio Mod-DE')
  assert.ok(!existsSync(path.join(outRoot, 'mod.info')))
  assert.ok(existsSync(path.join(outRoot, '42', 'mod.info')))
  assert.ok(existsSync(path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Tooltip.json')))
  const tip = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Tooltip.json'), 'utf8'
  ))
  assert.equal(tip.Tooltip_RadioMod, 'Mobilfunkradio')
  assert.ok(!('Tooltip_RadioMod_HowTo' in tip))
  assert.deepEqual(written, [
    '42/mod.info',
    'common/media/lua/shared/Translate/DE/Tooltip.json'
  ])
})

test('exportMod: dual-Layout (common + Version) — beide Quellen mergen in EINE Datei unter common/', () => {
  const dual = mods.find((m) => m.id === '9999000004/DualLayout')
  const targetDir = path.join(workdir, 'export6')
  const { written } = exportMod(dual, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'DualLayout-DE')
  assert.ok(!existsSync(path.join(outRoot, 'common', 'mod.info')))
  assert.ok(!existsSync(path.join(outRoot, '42.20', 'mod.info')))
  assert.ok(existsSync(path.join(outRoot, '42', 'mod.info')))
  const ui = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  // Beide Quellorte (common + 42.20) landen in DERSELBEN Ausgabedatei.
  assert.equal(ui.UI_Dual_Common, 'Gemeinsames Label')
  assert.equal(ui.UI_Dual_Version, 'Versions-spezifisches Label')
  assert.deepEqual(written, [
    '42/mod.info',
    'common/media/lua/shared/Translate/DE/UI.json'
  ])
})

test('id-Determinismus: derselbe Mod + dieselbe Sprache → dieselbe id (Re-Export ersetzt statt dupliziert)', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const id1 = singleModInfoId(coffee, 'DE')
  const id2 = singleModInfoId(coffee, 'DE')
  assert.equal(id1, id2)
  // Zwei komplett getrennte Exporte (unterschiedliche targetDirs) ergeben dieselbe id.
  const out1 = exportMod(coffee, 'DE', path.join(workdir, 'det1'))
  const out2 = exportMod(coffee, 'DE', path.join(workdir, 'det2'))
  const info1 = readFileSync(path.join(out1.targetPath, '42', 'mod.info'), 'utf8')
  const info2 = readFileSync(path.join(out2.targetPath, '42', 'mod.info'), 'utf8')
  assert.equal(info1.match(/^id=(.+)$/m)[1], info2.match(/^id=(.+)$/m)[1])
  // Andere Zielsprache → andere id (kein Ersetzen einer anderssprachigen Übersetzung).
  const idOtherLang = singleModInfoId(coffee, 'FR')
  assert.notEqual(id1, idOtherLang)
  // id besteht nur aus gültigen mod.info-id-Zeichen (alnum + '_', gegen echte
  // B42-Mods im Workshop verifiziert).
  assert.match(id1, /^[A-Za-z0-9_]+$/)
})

test('sanitizeFolderName: unzulässige Zeichen raus, Länge begrenzt', () => {
  assert.equal(sanitizeFolderName('Coffee Machines Fix'), 'Coffee Machines Fix')
  assert.equal(sanitizeFolderName('Mod: "Evil" / Twin\\Path*?<>|'), 'Mod_ _Evil_ _ Twin_Path_____')
  assert.equal(sanitizeFolderName('trailing dot.'), 'trailing dot')
  assert.equal(sanitizeFolderName('a'.repeat(300)).length, 100)
})

test('exportModsBundle: zwei Mods → EINE Mod, Key-Vereinigung pro Datei, loadModAfter nennt beide Quell-ids', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const targetDir = path.join(workdir, 'exportBundle')
  const { targetPath, written } = exportModsBundle([coffee, belt], 'DE', targetDir)
  // C4: ab mehreren Mods ein fester Ordnername + Anzahl (nicht die verketteten Namen).
  const outRoot = path.join(targetDir, 'Translation Bundle (2 mods)-DE')
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  assert.ok(existsSync(path.join(outRoot, '42', 'mod.info')))
  const info = readFileSync(path.join(outRoot, '42', 'mod.info'), 'utf8')
  // Nachbesserung 1: name= ist bei mehreren Mods eine kurze zählende Form
  // (wie der Ordnername), keine mit '+' verkettete Namensliste mehr.
  assert.match(info, /^name=Translation Bundle \(2 mods\) \(DE\)$/m)
  assert.match(info, /^author=Project Translate$/m)
  // id ist deterministisch aus der Mod-Menge (nicht game_version).
  assert.equal(info.match(/^id=(.+)$/m)[1], bundleModInfoId([coffee, belt], 'DE'))
  assert.ok(!info.includes('versionMin'))
  assert.ok(!info.includes('versionMax'))
  assert.ok(!info.includes('game_version'))
  // loadModAfter= nennt beide Quell-Mod-ids in Auswahlreihenfolge.
  assert.match(info, /^loadModAfter=CoffeeMachinesFix,ExpandedBelt$/m)

  // IG_UI.json: beide Mods haben eine 42.20-Übersetzung → EINE Datei unter
  // common/, Key-Vereinigung.
  const igUi = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'IG_UI.json'), 'utf8'
  ))
  assert.equal(igUi.IGUI_CraftingWindow_CoffeeMachine, 'X-presso')
  assert.equal(igUi.IGUI_ExpandedBelt_Left, 'Linkes Erweiterungsfach')
  assert.equal(Object.keys(igUi).length, 8)
  const ctx = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json'), 'utf8'
  ))
  assert.equal(ctx.ContextMenu_OPTION_COFFEE_MACHINE, 'Kaffeemaschine')
  const recipes = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Recipes.json'), 'utf8'
  ))
  assert.equal(recipes.ExpandBelt, 'Gürtel erweitern')
  const item = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'ItemName.json'), 'utf8'
  ))
  assert.equal(item['ExpandedBelt.ExpandedBelt'], 'Erweiterter Gürtel')
  // icon.png: erstes Poster (Coffee), neben der EINEN mod.info.
  assert.ok(existsSync(path.join(outRoot, '42', 'icon.png')))
  assert.deepEqual(written, [
    '42/icon.png',
    '42/mod.info',
    'common/media/lua/shared/Translate/DE/ContextMenu.json',
    'common/media/lua/shared/Translate/DE/IG_UI.json',
    'common/media/lua/shared/Translate/DE/ItemName.json',
    'common/media/lua/shared/Translate/DE/Recipes.json'
  ])
})

test('exportModsBundle: ein Mod → exakt wie exportMod', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const solo = path.join(workdir, 'exportBundleSolo')
  const bundle = exportModsBundle([coffee], 'DE', solo)
  const single = path.join(workdir, 'exportBundleSingle')
  const ref = exportMod(coffee, 'DE', single)
  // Gleicher Ordnername (ein Mod → sein Name, kein "Translation Bundle").
  assert.equal(path.basename(bundle.targetPath), path.basename(ref.targetPath))
  assert.equal(path.basename(bundle.targetPath), 'Coffee Machines Fix-DE')
  assert.deepEqual([...bundle.written].sort(), [...ref.written].sort())
  // gleiche id wie ein Solo-exportMod desselben Mods.
  const info = readFileSync(
    path.join(solo, 'Coffee Machines Fix-DE', '42', 'mod.info'), 'utf8'
  )
  const refInfo = readFileSync(
    path.join(single, 'Coffee Machines Fix-DE', '42', 'mod.info'), 'utf8'
  )
  assert.equal(info, refInfo)
  assert.match(info, /^name=Coffee Machines Fix Translation \(DE\)$/m)
})

test('exportModsBundle: Key-Kollision → späterer Mod gewinnt', () => {
  // Zwei isolierte common-Layout-Mods mit demselben Zielpfad + Key bauen wir
  // ad hoc: beide übersetzen common/.../DE/UI.json → UI_X, mit unterschiedlichen
  // Werten. Das Bundle muss genau EINE Datei mit dem Wert des späteren Mods (B)
  // enthalten.
  const coll = path.join(workdir, 'collide')
  for (const [dir, value] of [['a', 'Von Mod A'], ['b', 'Von Mod B']]) {
    const root = path.join(coll, dir)
    const enDir = path.join(root, 'common', 'media', 'lua', 'shared', 'Translate', 'EN')
    const deDir = path.join(root, 'common', 'media', 'lua', 'shared', 'Translate', 'DE')
    mkdirSync(enDir, { recursive: true })
    mkdirSync(deDir, { recursive: true })
    writeFileSync(path.join(enDir, 'UI.json'), JSON.stringify({ UI_X: 'Original X' }), 'utf8')
    writeFileSync(path.join(deDir, 'UI.json'), JSON.stringify({ UI_X: value }), 'utf8')
  }
  const mk = (dir, name) => ({
    id: dir, name, isBaseGame: false, versions: [],
    rootPath: path.join(coll, dir), poster: null, entryCount: 1, translatedCount: 1
  })
  const targetDir = path.join(workdir, 'exportBundleCollide')
  const modA = mk('a', 'Mod A')
  const modB = mk('b', 'Mod B')
  const { written } = exportModsBundle([modA, modB], 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Translation Bundle (2 mods)-DE')
  // EINE UI.json; der spätere Mod (B) gewinnt die Kollision.
  const ui = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  assert.deepEqual(ui, { UI_X: 'Von Mod B' })
  const info = readFileSync(path.join(outRoot, '42', 'mod.info'), 'utf8')
  // Nachbesserung 1: kurze zählende Form statt 'Mod A + Mod B'.
  assert.match(info, /^name=Translation Bundle \(2 mods\) \(DE\)$/m)
  assert.ok(!info.includes('versionMin'))
  assert.ok(!info.includes('versionMax'))
  assert.ok(!info.includes('game_version'))
  // Ad-hoc-Mod-Objekte ohne modInfoId → kein loadModAfter.
  assert.ok(!info.includes('loadModAfter'))
  // Bundle-id hängt nur von der (sortierten) Mod-Menge ab — Auswahlreihenfolge egal.
  assert.equal(bundleModInfoId([modA, modB], 'DE'), bundleModInfoId([modB, modA], 'DE'))
  assert.deepEqual(written, [
    '42/mod.info',
    'common/media/lua/shared/Translate/DE/UI.json'
  ])
})

test('C4: Bundle aus vielen Mods mit langen/unzulässigen Namen legt einen gültigen Ordner an', () => {
  // 60 Mods mit Namen, die zusammen (mit " + " verbunden) weit über die
  // Windows-Pfadlängen-Grenze liefen und dabei Zeichen enthalten, die in
  // Ordnernamen nicht erlaubt sind (":", "/", "*", ...).
  const many = []
  for (let i = 0; i < 60; i++) {
    many.push({
      id: `${9990000000 + i}/x`,
      name: `Some: Really "Long" Mod Name / Edition * ${i}`.repeat(2),
      isBaseGame: false,
      versions: [],
      rootPath: path.join(workdir, 'nonexistent', String(i)),
      poster: null,
      entryCount: 0,
      translatedCount: 0
    })
  }
  const targetDir = path.join(workdir, 'exportBundleMany')
  const { targetPath } = exportModsBundle(many, 'DE', targetDir)
  const folderName = path.basename(targetPath)
  assert.ok(folderName.length < 80, `Ordnername zu lang: ${folderName.length} Zeichen`)
  assert.equal(folderName, `Translation Bundle (${many.length} mods)-DE`)
  assert.ok(existsSync(targetPath))
  // Windows: keine der verbotenen Zeichen im Ordnernamen.
  assert.ok(!/[<>:"/\\|?*]/.test(folderName))
})

test('Nachbesserung 1: name= wächst nicht mit der Mod-Anzahl (kurze zählende Form statt Namenskette)', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const base = mods.find((m) => m.id === 'BASE')
  const targetDir = path.join(workdir, 'exportBundleManyNames')
  const { targetPath } = exportModsBundle([coffee, belt, base], 'DE', targetDir)
  const info = readFileSync(path.join(targetPath, '42', 'mod.info'), 'utf8')
  const nameLine = info.match(/^name=(.+)$/m)[1]
  assert.equal(nameLine, 'Translation Bundle (3 mods) (DE)')
  // keine verkettete Namensliste mehr im Wert.
  assert.ok(!nameLine.includes(' + '))
  assert.ok(nameLine.length < 60)
  // Einzelmod bleibt unverändert: sein eigener Name, nicht die zählende Form.
  const soloDir = path.join(workdir, 'exportSoloName')
  const solo = exportModsBundle([coffee], 'DE', soloDir)
  const soloInfo = readFileSync(path.join(solo.targetPath, '42', 'mod.info'), 'utf8')
  assert.match(soloInfo, /^name=Coffee Machines Fix Translation \(DE\)$/m)
})

test('exportMod: zwei Sprachen in einem Mod — eigene Sprachordner unter common/, mod.info nennt beide', () => {
  // Ad-hoc-Fixture (wie bei den Kollisions-Tests oben): EN + DE + FR-Baum eines
  // einzelnen common-Layout-Mods, ohne über scan()/fixtures-inject.js zu gehen.
  const root = path.join(workdir, 'multiLangMod')
  const enDir = path.join(root, 'common', 'media', 'lua', 'shared', 'Translate', 'EN')
  const deDir = path.join(root, 'common', 'media', 'lua', 'shared', 'Translate', 'DE')
  const frDir = path.join(root, 'common', 'media', 'lua', 'shared', 'Translate', 'FR')
  mkdirSync(enDir, { recursive: true })
  mkdirSync(deDir, { recursive: true })
  mkdirSync(frDir, { recursive: true })
  writeFileSync(path.join(enDir, 'UI.json'), JSON.stringify({ UI_Hello: 'Hello' }), 'utf8')
  writeFileSync(path.join(deDir, 'UI.json'), JSON.stringify({ UI_Hello: 'Hallo' }), 'utf8')
  writeFileSync(path.join(frDir, 'UI.json'), JSON.stringify({ UI_Hello: 'Bonjour' }), 'utf8')
  const mod = {
    id: 'multi/MultiLang', name: 'MultiLang', isBaseGame: false, versions: [],
    rootPath: root, poster: null, entryCount: 1, translatedCount: 1
  }
  const targetDir = path.join(workdir, 'exportMulti')
  // Sprachen absichtlich unsortiert übergeben — die Ausgabe sortiert selbst.
  const { targetPath, written, targetLangs } = exportMod(mod, ['FR', 'DE'], targetDir)
  assert.deepEqual(targetLangs, ['DE', 'FR'])
  const outRoot = path.join(targetDir, 'MultiLang-DE-FR')
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  // Beide Sprachordner existieren nebeneinander unter demselben common/-Baum.
  const deJson = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  const frJson = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'FR', 'UI.json'), 'utf8'
  ))
  assert.equal(deJson.UI_Hello, 'Hallo')
  assert.equal(frJson.UI_Hello, 'Bonjour')
  const info = readFileSync(path.join(outRoot, '42', 'mod.info'), 'utf8')
  assert.match(info, /^id=pt_multi_MultiLang_DE_FR$/m)
  assert.match(info, /^name=MultiLang Translation \(DE, FR\)$/m)
  assert.match(info, /^description=.*into DE, FR\.$/m)
  assert.deepEqual([...written].sort(), [
    '42/mod.info',
    'common/media/lua/shared/Translate/DE/UI.json',
    'common/media/lua/shared/Translate/FR/UI.json'
  ].sort())
})

test('exportModsBundle: zwei Mods, zwei Sprachen — Merge nur innerhalb derselben Sprache, Sprachen bleiben getrennt', () => {
  const coll = path.join(workdir, 'collideMultiLang')
  for (const [dir, values] of [
    ['a', { DE: 'Von A (DE)', FR: 'Von A (FR)' }],
    ['b', { DE: 'Von B (DE)', FR: 'Von B (FR)' }]
  ]) {
    const root = path.join(coll, dir)
    const enDir = path.join(root, 'common', 'media', 'lua', 'shared', 'Translate', 'EN')
    mkdirSync(enDir, { recursive: true })
    writeFileSync(path.join(enDir, 'UI.json'), JSON.stringify({ UI_X: 'Original X' }), 'utf8')
    for (const lang of ['DE', 'FR']) {
      const langDir = path.join(root, 'common', 'media', 'lua', 'shared', 'Translate', lang)
      mkdirSync(langDir, { recursive: true })
      writeFileSync(path.join(langDir, 'UI.json'), JSON.stringify({ UI_X: values[lang] }), 'utf8')
    }
  }
  const mk2 = (dir, name) => ({
    id: dir, name, isBaseGame: false, versions: [],
    rootPath: path.join(coll, dir), poster: null, entryCount: 1, translatedCount: 1
  })
  const modA = mk2('a', 'Mod A')
  const modB = mk2('b', 'Mod B')
  const targetDir = path.join(workdir, 'exportBundleMultiLang')
  const { targetPath, written, targetLangs } = exportModsBundle([modA, modB], ['FR', 'DE'], targetDir)
  assert.deepEqual(targetLangs, ['DE', 'FR'])
  const outRoot = path.join(targetDir, 'Translation Bundle (2 mods)-DE-FR')
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  const de = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  const fr = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'FR', 'UI.json'), 'utf8'
  ))
  // Späterer Mod (B) gewinnt die Kollision — unabhängig je Sprache.
  assert.deepEqual(de, { UI_X: 'Von B (DE)' })
  assert.deepEqual(fr, { UI_X: 'Von B (FR)' })
  const info = readFileSync(path.join(outRoot, '42', 'mod.info'), 'utf8')
  assert.match(info, /^name=Translation Bundle \(2 mods\) \(DE, FR\)$/m)
  assert.equal(info.match(/^id=(.+)$/m)[1], bundleModInfoId([modA, modB], ['DE', 'FR']))
  assert.deepEqual(written, [
    '42/mod.info',
    'common/media/lua/shared/Translate/DE/UI.json',
    'common/media/lua/shared/Translate/FR/UI.json'
  ])
})

test('4+ Sprachen: Ordnername/id werden zu "multi", Anzeigename nennt trotzdem alle Sprachen', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const targetDir = path.join(workdir, 'exportManyLangs')
  const { targetPath, written, targetLangs } = exportMod(coffee, ['FR', 'DE', 'IT', 'ES'], targetDir)
  assert.deepEqual(targetLangs, ['DE', 'ES', 'FR', 'IT'])
  const outRoot = path.join(targetDir, 'Coffee Machines Fix-multi')
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  const info = readFileSync(path.join(outRoot, '42', 'mod.info'), 'utf8')
  assert.match(info, /^id=pt_2688538916_Coffee_Machines_Fix_multi$/m)
  assert.match(info, /^name=Coffee Machines Fix Translation \(DE, ES, FR, IT\)$/m)
  // Nur DE hat in der Fixture eine Übersetzung — für die anderen Sprachen wird
  // nichts geschrieben (kein leerer Ordner), das Sprachsegment im Namen bleibt
  // trotzdem "multi" (hängt nur an der Anzahl der ANGEFRAGTEN Sprachen).
  assert.ok(existsSync(path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json')))
  assert.ok(!existsSync(path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'FR')))
  assert.ok(written.every((w) => !w.includes('/Translate/FR/')))
})

test('unbekannte Sprache wird abgelehnt (400)', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const targetDir = path.join(workdir, 'exportUnknownLang')
  assert.throws(
    () => exportMod(coffee, 'XX', targetDir),
    (err) => err.status === 400 && /valid target language/i.test(err.message)
  )
  // Eine gültige zusammen mit einer unbekannten Sprache: die unbekannte wird
  // stillschweigend verworfen, die gültige bleibt übrig.
  const { targetLangs } = exportMod(coffee, ['DE', 'XX'], targetDir)
  assert.deepEqual(targetLangs, ['DE'])
  // Nur unbekannte Sprachen → nichts bleibt übrig → Fehler.
  assert.throws(
    () => exportMod(coffee, ['XX', 'YY'], targetDir),
    (err) => err.status === 400
  )
})

test('D3: sourceLang != EN — Scan und Export lesen die DE-Baeume als Quelle', async () => {
  // DualLayout hat common + 42.20, beide mit vollstaendigen EN- UND DE-Baeumen
  // (siehe fixtures-inject.js) — mit sourceLang='DE' wird DE zur Quelle und EN
  // (das ohnehin schon vollstaendig ist) liefert die "Uebersetzung".
  const r = await scan(
    path.join(fakeRoot, 'gameRoot'),
    path.join(fakeRoot, 'workshop'),
    'EN',
    'DE'
  )
  const dual = r.mods.find((m) => m.id === '9999000004/DualLayout')
  assert.ok(dual, 'DualLayout nicht gefunden')
  const entries = r.entriesByModId[dual.id]
  const commonEntry = entries.find((e) => e.key === 'UI_Dual_Common')
  assert.ok(commonEntry)
  // Original kommt aus dem DE-Baum, nicht aus EN.
  assert.equal(commonEntry.original, 'Gemeinsames Label')
  // Die entryId traegt das DE-Pfadsegment (nicht /EN/).
  assert.match(commonEntry.id, /\/Translate\/DE\//)
  // EN ist bereits vollstaendig vorhanden → Pre-Fill/"Uebersetzung" gesetzt.
  assert.equal(commonEntry.translations.EN, 'Common shared label')
  assert.equal(commonEntry.preFilled.EN, true)

  const targetDir = path.join(workdir, 'exportSourceDe')
  const { targetPath, written } = exportMod(dual, 'EN', targetDir, 'DE')
  assert.ok(written.includes('42/mod.info'))
  const commonJson = JSON.parse(
    readFileSync(path.join(targetPath, 'common', 'media', 'lua', 'shared', 'Translate', 'EN', 'UI.json'), 'utf8')
  )
  assert.equal(commonJson.UI_Dual_Common, 'Common shared label')
})
