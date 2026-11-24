import { copyFile, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

interface Manifest {
  name: string
  version: string
  license?: string
  dependencies?: Record<string, string>
}

async function findPackage(name: string, from: string): Promise<string> {
  for (let dir = from; ; dir = dirname(dir)) {
    try {
      return await realpath(join(dir, 'node_modules', name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dir === dirname(dir)) throw error
    }
  }
}

export async function bundleNotices(
  output: string,
  roots: string[],
  editor?: string,
): Promise<void> {
  const found = new Map<string, string>()
  const visited = new Set<string>()
  async function walk(path: string, include: boolean): Promise<void> {
    if (visited.has(path)) return
    visited.add(path)
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) as Manifest
    if (include) {
      const files = (await readdir(path))
        .filter((name) =>
          /^(?:licen[sc]e|third[-_ ]?party[-_ ]?notices|notice)(?:\.[^.]+)?$/i.test(name),
        )
        .sort()
      if (!files.some((name) => /^licen[sc]e/i.test(name)))
        throw new Error('Missing license for ' + manifest.name)
      const text = await Promise.all(
        files.map(async (name) => name + '\n' + (await readFile(join(path, name), 'utf8')).trim()),
      )
      found.set(`${manifest.name}@${manifest.version}`, text.join('\n\n'))
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      await walk(await findPackage(name, path), !name.startsWith('@eihrteam/xml-'))
    }
  }
  for (const dir of roots) await walk(resolve(dir), false)
  if (editor) await walk(await findPackage(editor, process.cwd()), true)
  const text = [...found]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([name, notices]) => name + '\n' + '='.repeat(name.length) + '\n' + notices)
    .join('\n\n')
  await copyFile('LICENSE', join(output, 'LICENSE'))
  await writeFile(join(output, 'ThirdPartyNotices.txt'), text + '\n')
}
