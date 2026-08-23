# The interface this replaced

A frozen build of the UI as it stood at `1c18903`, kept only so the two can be
put side by side. Nothing here is source — it is the compiled bundle, lifted out
of `docs/` at the commit before the cutover.

One byte is changed: the bundle fetched `./grid.contract.json` and now fetches
`../grid.contract.json`, so both interfaces read the *same* model output rather
than this directory carrying a two-megabyte copy of its own. A side-by-side on
identical data is the comparison worth having.

It lives under `web/public/` because Vite copies that directory verbatim and
`emptyOutDir` would otherwise delete it from `docs/` on every build.

To delete it: remove this directory. Nothing imports it, nothing tests it, and
no build step knows it exists.
