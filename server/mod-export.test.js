// mod-export: installierbarer Übersetzungs-Mod — mod.info je Layout-Ort (neben
// media/, nicht mehr am Wurzelordner außer bei echtem Root-Layout/Basisspiel),
// gültige B42-Felder (id/name/author/description/versionMin statt game_version;
// bewusst OHNE versionMax — siehe Test weiter unten), deterministische id, nur
// übersetzte Einträge, pro Version eigene Bäume, sicherer Bundle-Ordnername.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, cpSync, readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { scan } = require('./scanner')
const {
  exportMod,
  exportModsBundle,
  highestVersion,
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

test('highestVersion: segmentweise numerisch', () => {
  assert.equal(highestVersion(['42', '42.13', '42.20']), '42.20')
  assert.equal(highestVersion(['42']), '42')
  assert.equal(highestVersion([]), null)
  assert.equal(highestVersion(['42.15.1', '42.15']), '42.15.1')
})

test('exportMod: mod.info im Versionsordner (neben media/), gültige B42-Felder', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const targetDir = path.join(workdir, 'export')
  const { targetPath, written } = exportMod(coffee, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Coffee Machines Fix-DE')
  // targetPath ist POSIX-Style (Projekt-Konvention)
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  // C1: mod.info liegt im Layout-Ordner (42.20), NICHT am Wurzelordner.
  assert.ok(!existsSync(path.join(outRoot, 'mod.info')))
  const infoPath = path.join(outRoot, '42.20', 'mod.info')
  assert.ok(existsSync(infoPath))
  const info = readFileSync(infoPath, 'utf8')
  // C2: gültige Felder, kein game_version.
  assert.match(info, /^id=pt_2688538916_Coffee_Machines_Fix_DE$/m)
  assert.match(info, /^name=Coffee Machines Fix Translation \(DE\)$/m)
  assert.match(info, /^author=Project Translate$/m)
  assert.match(info, /^description=.+Coffee Machines Fix.+DE.*$/m)
  assert.match(info, /^versionMin=42\.20$/m)
  assert.ok(!info.includes('versionMax'))
  assert.ok(!info.includes('game_version'))

  // Übersetzte Einträge: nur die neueste Version (42.20).
  const f42 = readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json'), 'utf8'
  )
  const f42obj = JSON.parse(f42)
  assert.equal(f42obj.ContextMenu_OPTION_COFFEE_MACHINE, 'Kaffeemaschine')
  // Ältere Version (42) wird nicht exportiert
  assert.ok(
    !existsSync(
      path.join(outRoot, '42', 'media', 'lua', 'shared', 'Translate', 'DE', 'ItemName.json')
    )
  )
  assert.ok(written.includes('42.20/mod.info'))
  assert.ok(written.length >= 3)
})

test('mod.info: versionMin gesetzt, versionMax bewusst NICHT geschrieben', () => {
  // Regressionsschutz: versionMax ist in echten B42-Mods selten (62 von 909
  // ausgewerteten mod.info-Dateien) und wird dort als bewusster Deckel für
  // aufgegebene/B41-only-Mods benutzt (Werte wie 41.99, 42.12.99). Ein
  // Übersetzungs-Mod soll mit künftigen Spiel-Versionen kompatibel bleiben —
  // versionMax würde ihn beim nächsten Update fälschlich als inkompatibel
  // markieren. Deshalb schreibt der Export nur versionMin.
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const targetDir = path.join(workdir, 'export1b')
  exportMod(coffee, 'DE', targetDir)
  const info = readFileSync(
    path.join(targetDir, 'Coffee Machines Fix-DE', '42.20', 'mod.info'), 'utf8'
  )
  assert.match(info, /^versionMin=42\.20$/m)
  assert.ok(!/^versionMax=/m.test(info), 'versionMax darf nicht in der mod.info stehen')
})

test('exportMod: icon.png wird mitkopiert und in mod.info als poster=/icon= deklariert', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const targetDir = path.join(workdir, 'export2')
  const { written } = exportMod(belt, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Expanded Belt-DE')
  // C1: icon.png liegt neben der mod.info seines Layout-Orts (42.20), nicht am Root.
  assert.ok(existsSync(path.join(outRoot, '42.20', 'icon.png')))
  assert.ok(!existsSync(path.join(outRoot, 'icon.png')))
  assert.ok(written.includes('42.20/icon.png'))
  // C3: das kopierte Bild ist in derselben mod.info deklariert.
  const info = readFileSync(path.join(outRoot, '42.20', 'mod.info'), 'utf8')
  assert.match(info, /^poster=icon\.png$/m)
  assert.match(info, /^icon=icon\.png$/m)
})

test('exportMod: Basisspiel → mod.info am Wurzelordner, ohne versionMin', () => {
  const base = mods.find((m) => m.id === 'BASE')
  const targetDir = path.join(workdir, 'export3')
  const { targetPath } = exportMod(base, 'DE', targetDir)
  assert.equal(targetPath, path.join(targetDir, 'Project Zomboid (Base Game)-DE').replace(/\\/g, '/'))
  // Basisspiel ist echtes Root-Layout → mod.info am Wurzelordner.
  const info = readFileSync(path.join(targetPath, 'mod.info'), 'utf8')
  assert.match(info, /^id=pt_BASE_DE$/m)
  assert.ok(!info.includes('game_version'))
  assert.ok(!info.includes('versionMin'))
  assert.ok(!info.includes('versionMax'))
  // UI.json: 2 von 4 übersetzt → nur 2 Keys; Basisspiel ohne Version-Ordner
  const ui = JSON.parse(readFileSync(
    path.join(targetPath, 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  assert.equal(Object.keys(ui).length, 2)
  assert.equal(ui.UI_MainMenu_Play, 'Spielen')
})

test('layoutLocations: common / root / reines common / dual', () => {
  const fn = mods.find((m) => m.id === '9999000001/Field Notes')
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  const gear = mods.find((m) => m.id === '9999000003/CommonGear')
  const dual = mods.find((m) => m.id === '9999000004/DualLayout')
  assert.ok(fn && radio && gear && dual, 'alle vier Layout-Fixtures gefunden')
  assert.deepEqual(layoutLocations(fn).map((l) => l.rel), ['common'])
  assert.deepEqual(layoutLocations(radio).map((l) => l.rel), [''])
  assert.deepEqual(layoutLocations(gear).map((l) => l.rel), ['common'])
  assert.deepEqual(layoutLocations(dual).map((l) => l.rel), ['common', '42.20'])
  // reines common-Layout: versions leer → kein versionMin/versionMax
  assert.deepEqual(gear.versions, [])
  assert.equal(highestVersion(gear.versions), null)
})

test('exportMod: common-Layout mit TXT (Lua-Translate) — mod.info in common/', () => {
  const fn = mods.find((m) => m.id === '9999000001/Field Notes')
  const targetDir = path.join(workdir, 'export4')
  const { written } = exportMod(fn, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Field Notes-DE')
  const info = readFileSync(path.join(outRoot, 'common', 'mod.info'), 'utf8')
  // common-Layout ohne Versionsordner → kein versionMin/versionMax
  assert.ok(!info.includes('versionMin'))
  assert.ok(!info.includes('versionMax'))
  assert.match(info, /^name=Field Notes Translation \(DE\)$/m)
  // TXT → Lua-Table unter common/.../DE/Sandbox_DE.txt
  const p = path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox_DE.txt')
  assert.ok(existsSync(p))
  const txt = readFileSync(p, 'utf8')
  assert.match(txt, /^Sandbox_DE = \{/)
  assert.match(txt, /Sandbox_FieldNotes = \[\[Feldnotizen\]\]/)
  // unübersetzte Keys (HowTo, TipOne) werden nicht exportiert
  assert.ok(!txt.includes('Sandbox_FieldNotes_HowTo'))
  assert.ok(!txt.includes('Sandbox_FieldNotes_TipOne'))
  assert.deepEqual(written, [
    'common/mod.info',
    'common/media/lua/shared/Translate/DE/Sandbox_DE.txt'
  ])
})

test('exportMod: root-Layout (Translate am Mod-Root, JSON) — mod.info am Wurzelordner', () => {
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  const targetDir = path.join(workdir, 'export5')
  const { written } = exportMod(radio, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Radio Mod-DE')
  // echtes Root-Layout → mod.info am Wurzelordner, ohne common/
  assert.ok(existsSync(path.join(outRoot, 'mod.info')))
  assert.ok(existsSync(path.join(outRoot, 'media', 'lua', 'shared', 'Translate', 'DE', 'Tooltip.json')))
  const tip = JSON.parse(readFileSync(
    path.join(outRoot, 'media', 'lua', 'shared', 'Translate', 'DE', 'Tooltip.json'), 'utf8'
  ))
  assert.equal(tip.Tooltip_RadioMod, 'Mobilfunkradio')
  assert.ok(!('Tooltip_RadioMod_HowTo' in tip))
  assert.ok(!existsSync(path.join(outRoot, 'common')))
  assert.deepEqual(written, [
    'mod.info',
    'media/lua/shared/Translate/DE/Tooltip.json'
  ])
})

test('exportMod: dual-Layout (common + Version) — je eine mod.info pro Ort', () => {
  const dual = mods.find((m) => m.id === '9999000004/DualLayout')
  const targetDir = path.join(workdir, 'export6')
  const { written } = exportMod(dual, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'DualLayout-DE')
  // common: kein versionMin (Fallback-Ort ohne Versionsbindung)
  const commonInfo = readFileSync(path.join(outRoot, 'common', 'mod.info'), 'utf8')
  assert.ok(!commonInfo.includes('versionMin'))
  // 42.20: mit versionMin, ohne versionMax
  const verInfo = readFileSync(path.join(outRoot, '42.20', 'mod.info'), 'utf8')
  assert.match(verInfo, /^versionMin=42\.20$/m)
  assert.ok(!verInfo.includes('versionMax'))
  // beide mod.info tragen dieselbe id (derselbe Mod)
  assert.equal(
    commonInfo.match(/^id=(.+)$/m)[1],
    verInfo.match(/^id=(.+)$/m)[1]
  )
  const common = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  const ver = JSON.parse(readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  assert.equal(common.UI_Dual_Common, 'Gemeinsames Label')
  assert.equal(ver.UI_Dual_Version, 'Versions-spezifisches Label')
  assert.deepEqual(written.sort(), [
    'common/mod.info',
    '42.20/mod.info',
    'common/media/lua/shared/Translate/DE/UI.json',
    '42.20/media/lua/shared/Translate/DE/UI.json'
  ].sort())
})

test('id-Determinismus: derselbe Mod + dieselbe Sprache → dieselbe id (Re-Export ersetzt statt dupliziert)', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const id1 = singleModInfoId(coffee, 'DE')
  const id2 = singleModInfoId(coffee, 'DE')
  assert.equal(id1, id2)
  // Zwei komplett getrennte Exporte (unterschiedliche targetDirs) ergeben dieselbe id.
  const out1 = exportMod(coffee, 'DE', path.join(workdir, 'det1'))
  const out2 = exportMod(coffee, 'DE', path.join(workdir, 'det2'))
  const info1 = readFileSync(path.join(out1.targetPath, '42.20', 'mod.info'), 'utf8')
  const info2 = readFileSync(path.join(out2.targetPath, '42.20', 'mod.info'), 'utf8')
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

test('exportModsBundle: zwei Mods → EINE Mod, Key-Vereinigung pro Pfad', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const targetDir = path.join(workdir, 'exportBundle')
  const { targetPath, written } = exportModsBundle([coffee, belt], 'DE', targetDir)
  // C4: ab mehreren Mods ein fester Ordnername + Anzahl (nicht die verketteten Namen).
  const outRoot = path.join(targetDir, 'Translation Bundle (2 mods)-DE')
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  assert.ok(existsSync(path.join(outRoot, '42.20', 'mod.info')))
  const info = readFileSync(path.join(outRoot, '42.20', 'mod.info'), 'utf8')
  assert.match(info, /^name=Coffee Machines Fix \+ Expanded Belt Translation \(DE\)$/m)
  assert.match(info, /^author=Project Translate$/m)
  // id ist deterministisch aus der Mod-Menge (nicht game_version).
  assert.equal(info.match(/^id=(.+)$/m)[1], bundleModInfoId([coffee, belt], 'DE'))
  assert.match(info, /^versionMin=42\.20$/m)
  assert.ok(!info.includes('versionMax'))
  assert.ok(!info.includes('game_version'))

  // IG_UI.json: beide Mods haben 42.20/.../DE/IG_UI.json → EINE Datei, Key-Vereinigung.
  const igUi = JSON.parse(readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'IG_UI.json'), 'utf8'
  ))
  assert.equal(igUi.IGUI_CraftingWindow_CoffeeMachine, 'X-presso')
  assert.equal(igUi.IGUI_ExpandedBelt_Left, 'Linkes Erweiterungsfach')
  assert.equal(Object.keys(igUi).length, 8)
  const ctx = JSON.parse(readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json'), 'utf8'
  ))
  assert.equal(ctx.ContextMenu_OPTION_COFFEE_MACHINE, 'Kaffeemaschine')
  const recipes = JSON.parse(readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'Recipes.json'), 'utf8'
  ))
  assert.equal(recipes.ExpandBelt, 'Gürtel erweitern')
  const item = JSON.parse(readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'ItemName.json'), 'utf8'
  ))
  assert.equal(item['ExpandedBelt.ExpandedBelt'], 'Erweiterter Gürtel')
  // icon.png: erstes Poster (Coffee), neben der mod.info seines Orts.
  assert.ok(existsSync(path.join(outRoot, '42.20', 'icon.png')))
  assert.deepEqual(written, [
    '42.20/icon.png',
    '42.20/media/lua/shared/Translate/DE/ContextMenu.json',
    '42.20/media/lua/shared/Translate/DE/IG_UI.json',
    '42.20/media/lua/shared/Translate/DE/ItemName.json',
    '42.20/media/lua/shared/Translate/DE/Recipes.json',
    '42.20/mod.info'
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
    path.join(solo, 'Coffee Machines Fix-DE', '42.20', 'mod.info'), 'utf8'
  )
  const refInfo = readFileSync(
    path.join(single, 'Coffee Machines Fix-DE', '42.20', 'mod.info'), 'utf8'
  )
  assert.equal(info, refInfo)
  assert.match(info, /^name=Coffee Machines Fix Translation \(DE\)$/m)
})

test('exportModsBundle: Key-Kollision → späterer Mod gewinnt', () => {
  // Zwei isolierte common-Layout-Mods mit demselben Zielpfad + Key bauen wir
  // ad hoc: beide übersetzen common/.../DE/UI.json → UI_X, mit unterschiedlichen
  // Werten. Das Bundle muss genau EINE Datei mit dem Wert des späteren Mods (B)
  // enthalten. versions: [] → reines common-Layout, kein versionMin/versionMax.
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
  // mod.info: reines common-Layout → kein versionMin/versionMax.
  const info = readFileSync(path.join(outRoot, 'common', 'mod.info'), 'utf8')
  assert.match(info, /^name=Mod A \+ Mod B Translation \(DE\)$/m)
  assert.ok(!info.includes('versionMin'))
  assert.ok(!info.includes('versionMax'))
  assert.ok(!info.includes('game_version'))
  // Bundle-id hängt nur von der (sortierten) Mod-Menge ab — Auswahlreihenfolge egal.
  assert.equal(bundleModInfoId([modA, modB], 'DE'), bundleModInfoId([modB, modA], 'DE'))
  assert.deepEqual(written, [
    'common/media/lua/shared/Translate/DE/UI.json',
    'common/mod.info'
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
