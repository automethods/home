"""Assemble the homepage and verified project releases for Cloudflare Pages."""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import shutil
from urllib.request import Request, urlopen
from zipfile import ZipFile
from automobile_publication import add_language_bootstrap, is_research_document


def verified_files(archive, release, label):
    with ZipFile(archive) as zipped:
        names = [name for name in zipped.namelist() if not name.endswith('/')]
        prefix = names[0].split('/', 1)[0] + '/'
        actual = {name.removeprefix(prefix) for name in names}
        if actual != set(release['files']):
            raise ValueError(f'{label} archive file list does not match the verified release')
        files = {}
        for relative, expected in release['files'].items():
            content = zipped.read(prefix + relative)
            if hashlib.sha256(content).hexdigest() != expected:
                raise ValueError(f'{label} checksum mismatch: {relative}')
            files[relative] = content
    return files


def assemble(root, manifest, archive, mechanics_archive=None):
    release = manifest['automobile']
    files = {name: content for name, content in verified_files(archive, release, 'Automobile').items()
             if not is_research_document(name)}
    files['index.html'] = add_language_bootstrap(files['index.html'])
    mechanics = {}
    if 'mechanics' in manifest:
        if mechanics_archive is None:
            raise ValueError('Machine Elements archive is required for the pinned release')
        if any(name.startswith('projects/mechanics/') for name in manifest['homeFiles']):
            raise ValueError('Machine Elements must come from its own repository, not homeFiles')
        mechanics = verified_files(mechanics_archive, manifest['mechanics'], 'Machine Elements')

    output = root / 'public'
    if output.exists():
        shutil.rmtree(output)
    for relative in manifest['homeFiles']:
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / relative, target)
    for relative, content in files.items():
        target = output / 'projects/automobile' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    for relative, content in mechanics.items():
        target = output / 'projects/mechanics' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    print(f"Ready: public/ with Automobile v{release['version']} ({len(files)} verified project files)")
    if mechanics:
        print(f"Machine Elements v{manifest['mechanics']['version']} ({len(mechanics)} verified project files)")
    return output


def download_release(release):
    url = f"https://github.com/{release['repository']}/archive/{release['commit']}.zip"
    request = Request(url, headers={'User-Agent': 'AutoMethods-Cloudflare-build'})
    with urlopen(request, timeout=90) as response:
        return BytesIO(response.read())


def main():
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / 'build-manifest.json').read_text())
    archive = download_release(manifest['automobile'])
    mechanics = download_release(manifest['mechanics']) if 'mechanics' in manifest else None
    assemble(root, manifest, archive, mechanics)


if __name__ == '__main__':
    main()
