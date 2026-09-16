# Economie-assistent

Dutch and English officer workspace for source-backed answers, passage verification,
human review and a maintainable document library. Built for the PROV-AI “Answer Like
the Expert” challenge with Next.js, SQLite and a configurable model provider.

Start with [setup and operation](web/README.md). The implementation contract and
acceptance questions are in [PLAN.md](PLAN.md); the demo narration is in
[docs/video-script.md](docs/video-script.md).

See [combined integration and validation](docs/final-integration.md) for the
branch reconciliation, repeatable checks, and real-provider acceptance status.

The redesigned responsive interface includes a persistent **NL / EN** switch on
the login page and in the workspace. It changes interface text and date formatting;
new answers, email drafts and summaries use the selected language. English queries
also expand into Dutch search terms to retrieve the supplied Dutch documents.
Source quotations and existing saved content remain in their original language.

The nine supplied PDFs are real source material. Historical and unverified
documents retain their status. Generated text requires officer review, and the
application never sends email automatically.
