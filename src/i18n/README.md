# Site localization

The English message catalog covers application and Worker prose, React JSX,
documentation, accessibility labels, errors, metadata, exported report lines,
and documentation diagram labels. It deliberately includes some extra internal
strings; catalog presence is not a promise that every string is rendered.
Technical units, repository identities, publisher names, commands, and HTTP
headers remain unchanged. User-entered data must never be translated remotely.

## Maintaining catalogs

```sh
node scripts/i18n-catalog.mjs --extract --write
node scripts/i18n-catalog.mjs --write
# Or update only a selected locale:
node scripts/i18n-catalog.mjs zh-TW --write
node scripts/localize-diagrams.mjs
```

The extractor uses the installed TypeScript 7 AST API, including React's JSX
whitespace normalization and numbered template placeholders. Without `--write`,
commands print patches rather than changing files; large patch output can be
truncated by terminal wrappers, so use `--write` for generated catalogs.

Existing translations are reused and the checked-in terminology normalization
is reapplied. Automatic translation is disabled. New source messages make the
catalog command fail until a reviewed translation is supplied for every locale.
There are no translation requests from the build, server, or visitor browser.

The initial 2026-09-14 catalogs were machine-generated, with model-authored
completion of a small number of missing public labels and source-context
technical/Chinese terminology corrections after the endpoint returned HTTP 429.
They have not received comprehensive native-speaker review. Reviewed corrections
belong in `src/i18n/reviewed/`; these overrides take precedence over the legacy
catalog and are not replaced by catalog maintenance.

Runtime translation uses exact message keys only. Interpolated values are opaque
parameters and are never searched, normalized, or translated. Do not restore
fuzzy matching, case-insensitive matching, or automatic localization of arbitrary
React expressions; those mechanisms can corrupt model identifiers, units, user
content, and technical measurements.

The browser downloads only the selected locale pack; the server loads the full
catalog set for localized documentation HTML and Markdown. A failed language
switch keeps the previous language and current form data. Initial asset failure
falls back to English with visible feedback without discarding URL settings.

The build checks source-catalog drift and refuses missing or invalid translations.
All locales must have the same keys as `messages.json` and exactly preserve each
message's numbered placeholders. Run localization tests, the full test suite,
build, diagram generation, and browser checks after changes. Translation quality,
visual overflow, persistence, cross-page navigation, RTL layout, exports, and
non-JavaScript documentation require verification beyond key coverage.
