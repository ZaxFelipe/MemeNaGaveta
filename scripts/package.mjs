// Depois do `tauri build`: copia o exe para release/ e gera o zip portátil.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const { version } = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(join(root, 'package.json'), 'utf8')))
const releaseDir = join(root, 'release')
const exe = join(releaseDir, 'MemeNaGaveta.exe')
const zip = join(releaseDir, `MemeNaGaveta-${version}-portatil.zip`)

mkdirSync(releaseDir, { recursive: true })
copyFileSync(join(root, 'src-tauri', 'target', 'release', 'meme-na-gaveta.exe'), exe)
rmSync(zip, { force: true })
execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -LiteralPath $env:EXE -DestinationPath $env:ZIP'], {
  env: { ...process.env, EXE: exe, ZIP: zip },
  stdio: 'inherit'
})

const mb = (p) => (statSync(p).size / 1024 ** 2).toFixed(1)
console.log(`\n${exe}  ${mb(exe)} MB\n${zip}  ${mb(zip)} MB`)
