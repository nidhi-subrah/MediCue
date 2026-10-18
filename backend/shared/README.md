# Packaged copy of `shared/catalog.json`

`../../shared/catalog.json` (the repository's `shared/` folder) is the only file to edit. This copy exists so a
deployment that ships just `backend/` (for example Vercel with Root Directory = `backend`) still has the catalog
at startup. `app/config.py` prefers the repository copy whenever it is present.

After editing the catalog, refresh this copy (from the repository root):

    cp shared/catalog.json backend/shared/catalog.json

`tests/test_packaging.py` fails if the two ever differ.
