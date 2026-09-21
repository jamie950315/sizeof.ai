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

Every locale file is one complete catalog of explicit full-message values. New
or corrected translations must be written from the full English message and its
product context; do not derive
it from another locale, concatenate translated fragments, apply character or
terminology substitutions, or use an automatic translation service. Catalog
maintenance only validates completeness and placeholders. It never rewrites a
translation. New source messages make the build fail until every locale supplies
an explicit reviewed value. There are no translation requests from the build,
server, or visitor browser, and there is no legacy override layer.

Mixed JSX prose is extracted as one message with numbered opaque parameters.
For example, a review date inside a sentence is `{0}`; the surrounding sentence
is translated as one unit while the date is preserved. Short fragments are not
assembled into a sentence at runtime.

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
