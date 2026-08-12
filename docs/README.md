# Documentation

`Control-Room-Documentation.docx` is the full operating guide and technical
documentation — 20 pages, in six parts. Parts 1 and 2 are for Josh and need no
technical background; Parts 3 to 6 are for whoever maintains or deploys it.

It is generated, not hand-edited, so it can be kept honest as the system
changes:

```bash
pip install python-docx
python docs/build_docs.py docs/Control-Room-Documentation.docx
```

**Edit `build_docs.py`, not the .docx.** A hand-edit to the document is lost the
next time anyone regenerates it.

The table of contents is a Word field. It rebuilds itself when the document is
opened, so page numbers stay correct after an edit.
