# UI text principles

How prodmesh writes on-screen words. Adopted 2026-07-15 after the Admin panels
accumulated explanatory paragraphs that age badly.

1. **Labels name; they don't explain.** If a control needs a sentence to be
   usable, the fix is a better label, not more prose.
2. **No intro paragraphs under panel titles.** The section label + title carry
   the context. Screens should read like a control surface, not a manual.
3. **Supplementary knowledge goes in a HelpTip** (`src/components/HelpTip.tsx`
   — the circular "?"). Good tooltip content: where to find an ID, what a term
   means, a non-obvious consequence. It must be *optional* reading.
4. **Must-know information is never tooltip-only.** Destructive consequences
   belong in the confirm dialog; errors and empty-state guidance stay inline.
5. **Write timeless.** No lists that grow stale ("configure its Quick Access
   tiles"), no "new"/"now", no feature inventories. Referencing implementation
   (file names, tables) is allowed only for clearly transitional dev notes that
   will be deleted with the migration they describe.
6. **Empty and loading states are short noun phrases.** "No rooms yet." /
   "Loading…" — not apologies or instructions.
7. **Status feedback is one word where possible.** "Saved." Present tense,
   no exclamation points.
