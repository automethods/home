"""Keep research documents out of Automobile website publication copies."""
from pathlib import PurePosixPath


GUIDE_PDFS = {'downloads/methodical-guide.pdf', 'downloads/methodical-guide-en.pdf'}


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
