"""Assemble the homepage and a verified Automobile release for Cloudflare Pages."""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import shutil
from urllib.request import Request, urlopen
from zipfile import ZipFile
from automobile_publication import is_research_document


def assemble(root, manifest, archive):
    release = manifest['automobile']
    with ZipFile(archive) as zipped:
        names = [name for name in zipped.namelist() if not name.endswith('/')]
        prefix = names[0].split('/', 1)[0] + '/'
        actual = {name.removeprefix(prefix) for name in names}
        if actual != set(release['files']):
            raise ValueError('Automobile archive file list does not match the verified release')
        files = {}
        for relative, expected in release['files'].items():
            content = zipped.read(prefix + relative)
            if hashlib.sha256(content).hexdigest() != expected:
                raise ValueError(f'Automobile checksum mismatch: {relative}')
            if not is_research_document(relative):
                files[relative] = content

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
    print(f"Ready: public/ with Automobile v{release['version']} ({len(files)} verified project files)")
    return output


def main():
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / 'build-manifest.json').read_text())
    release = manifest['automobile']
    url = f"https://github.com/{release['repository']}/archive/{release['commit']}.zip"
    request = Request(url, headers={'User-Agent': 'AutoMethods-Cloudflare-build'})
    with urlopen(request, timeout=90) as response:
        archive = BytesIO(response.read())
    assemble(root, manifest, archive)


if __name__ == '__main__':
    main()
