"""Prepare Automobile research references and language startup for publication."""
from pathlib import PurePosixPath


GUIDE_PDFS = {'downloads/methodical-guide.pdf', 'downloads/methodical-guide-en.pdf'}
LANGUAGE_SCRIPTS = b'\n  <script src="/language.js"></script>\n  <script src="/api/language.js"></script>'


def add_language_bootstrap(content):
    if b'<script src="/api/language.js"></script>' in content:
        return content
    if b'<head>' not in content:
        raise ValueError('Automobile index.html is missing its head element')
    return content.replace(b'<head>', b'<head>' + LANGUAGE_SCRIPTS, 1)


def is_research_document(relative):
    path = PurePosixPath(relative)
    suffix = path.suffix.lower()
    return (suffix == '.pdf' and path.as_posix() not in GUIDE_PDFS) or (
        path.parts[:2] == ('Data', 'Vehicle') and suffix in {'.html', '.htm', '.mhtml'}
    )


def clean_publication(folder):
    removed = []
    for path in folder.rglob('*'):
        if path.is_file() and is_research_document(path.relative_to(folder).as_posix()):
            removed.append(path.relative_to(folder).as_posix())
            path.unlink()
    return sorted(removed)
