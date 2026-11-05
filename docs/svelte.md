# Svelte integration

Framework supplies a polished Svelte implementation without making that implementation mandatory.
The portable Spec and Kernel do not depend on Svelte.

## Code map

- Semantic theme: [`src/svelte/theme.css`](../src/svelte/theme.css)
- UI primitives: [`src/svelte/ui`](../src/svelte/ui)
- Authoring surfaces: [`src/svelte/authoring`](../src/svelte/authoring)
- Operational surfaces: [`src/svelte/operations`](../src/svelte/operations)
- Settings surfaces: [`src/svelte/settings`](../src/svelte/settings)
- Record presentation: [`src/svelte/records`](../src/svelte/records)
- Optional people and membership surfaces: [`src/svelte/people`](../src/svelte/people), [guide](people.md)
- Public hooks: [`src/svelte/hooks`](../src/svelte/hooks)
- Private shared implementation: [`src/svelte/internal`](../src/svelte/internal)
- Exact package exports: [`package.json`](../package.json)

## Ownership

| Layer                                | Owns                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `@jthum/framework/svelte/ui/*`       | Framework-owned shadcn-Svelte source and reusable visual primitives                         |
| `@jthum/framework/svelte/authoring`  | Portable-definition editors, working models, adapters, and authoring interactions           |
| `@jthum/framework/svelte/operations` | Rule execution history, inspectors, launchers, and ActorRequest interaction                 |
| `@jthum/framework/svelte/settings`   | Host-arranged and user-defined Workspace setting surfaces                                   |
| `@jthum/framework/svelte/records`    | Host-fed record details and non-modal panels                                                |
| `@jthum/framework/svelte/people`     | Optional host-fed member directory, query filters and permission selection                  |
| Implementing app                     | Routes, product shell, navigation, app screens, product policy, and app-specific components |

An implementing app does not move all of its Svelte code into Framework. A component belongs in
Framework only when it is useful to more than one host and can depend on portable definitions or
public client contracts instead of host globals.

## Default setup

Import the Framework theme after Tailwind and shadcn-Svelte, then place host overrides after it:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn-svelte/tailwind.css";
@import "@jthum/framework/svelte/theme.css";

:root {
  --primary: oklch(0.55 0.2 265);
  --radius: 0.75rem;
}
```

The theme uses semantic variables. A host may override light and dark values without forking the
components. Product-specific tokens do not belong in the Framework theme.

The shared disclosure and floating-menu primitives use `tw-animate-css` utilities. Hosts supply
that stylesheet as shown above. Disclosures animate measured height over 180ms; floating menus
use a subtle fade, scale and slide, with a quicker exit. These primitives disable animation for
`prefers-reduced-motion`. Keep padding inside disclosure content so its animated outer box can
collapse completely; Bits UI continues to own presence, keyboard interaction and focus.

## Customization levels

Operational forms can reuse `FieldInputs` through the granular
`@jthum/framework/svelte/authoring/field-inputs` default export, with `fieldInputDefaults` and
`parseFieldInputs` from `@jthum/framework/svelte/authoring/data`. This keeps the eager authoring
barrel out of a read-only surface and preserves lazy loading of heavier editors.

Ordinary `Tabs.List` and `Tabs.Trigger` use shared sizing, balanced insets, typography and icon
spacing. Consumers should limit tab classes to surrounding layout (for example, wrapping or width),
not repeat height, padding or line-height overrides per screen. Intentional alternate treatments use
the named `line` or `rail` list variants; vertical tab alignment is handled by the primitive.

`Table.Root` supplies one horizontally scrollable chrome frame. Column headings and totals sit
on the chrome, while `Table.Body` paints a continuous rounded content panel using native cells.
Its row colours are opaque mixes over the card surface, so hover and selection do not expose
the chrome through the body. Header, body and footer share one native column layout.
Use `variant="inset"` when a host intentionally needs an unframed table inside an existing content
surface. Shared primitives own spacing, panel edges and separators; consumers should not duplicate
these styles. Selected rows use a very light neutral foreground/card mix with a faint diagonal
pattern, independent of the accent colour. Ordinary hover remains unpatterned.
`aria-sort="ascending"` or `"descending"`
on a sorted `Table.Head` emphasizes its label.
Table colours inherit the host's semantic tokens in both light and dark themes.

Use the least powerful level that solves the requirement:

1. Override semantic CSS variables for colour, radius, typography, chrome, and surfaces.
2. Pass `class` for host layout concerns supported by a component.
3. Use named snippets and callbacks exposed by an editor for actions or host-owned content.
4. Compose exported editor controls into a different outer layout.
5. Replace the whole Framework component while keeping the same Spec and client contracts.

Framework components import Framework's default UI primitives internally. There is deliberately no
global component-override registry: ordinary Svelte composition is more explicit, tree-shakeable,
and easier to understand. A host that needs a different primitive can compose the lower-level
authoring exports or replace the relevant editor.

```svelte
<script lang="ts">
  import { PageHeader } from "@jthum/framework/svelte/ui/page-header";
  import MyAction from "$lib/components/my-action.svelte";
</script>

<PageHeader title="Collections" description="Shape the information this app manages.">
  {#snippet actions()}
    <MyAction />
  {/snippet}
</PageHeader>
```

## Record presentation

`RecordDetails` presents an identity header, optional description/status summary, labelled properties,
long-form text and optional host actions, related content and metadata. Hosts supply `RecordProperty`
values and may replace value rendering with the `renderValue` snippet. Optional `highlight` hints
promote up to three properties on full pages into an at-a-glance strip; additional highlights remain in the
property list. Properties retain the supplied order rather than being categorized by field type.
Each property appears once. Long-form content and properties share a responsive reading layout
on wide containers and stack on narrower ones. `compact` keeps all facts together in a responsive
two-column grid, with labels above values. Facts, Summary, longer text, related content and
timestamps share one continuous card-colour surface.
It omits numeric promotion, field dividers and the visible Details heading; full pages retain the framed Details section.
`showHeader={false}` avoids repeating the enclosing panel's title. No field selection,
querying, routing or record mutations happen inside this component.

`RecordPanel` is a focusable complementary region with a title, close control, optional full-page
link, a navigation snippet and a `summary` snippet beside the title for status or identity metadata.
The panel provides a neutral Chrome header and footer around an unpadded, rounded card-colour
scrolling body. Its title uses medium weight. Navigation and the full-page link sit
at the bottom, leaving the header for identity and closing.
The panel focuses itself on mount, supports Escape within the panel, and
does not trap focus, lock scrolling or create a modal backdrop. It leads with the item title and
supports an optional subtitle. The host owns floating/docked/mobile layout,
selection, lazy loading, previous/next order, transitions and return focus after closing.

Use granular imports such as `@jthum/framework/svelte/records/record-details` and
`@jthum/framework/svelte/records/record-panel`. Presentation types are available separately from
`@jthum/framework/svelte/records/data`. Rendering contracts are covered in
[`records.spec.ts`](../src/svelte/records/records.spec.ts).

## Editor contract

`BlockPicker` accepts catalog metadata through `blocks` and optional category labels through
`categories`. It never imports a host registry or loads renderer code. Hosts may provide
`onPreview(key)` to preload renderers and `getIcon(block)` to customize catalog icons. Selection
always comes from the currently visible results, so filtering cannot submit a hidden Block.
`presentation="inline"` makes the picker a searchable inline list instead of a Dialog; the
default Dialog remains available to standalone consumers. `BlockSettings` similarly accepts
`presentation="inline"` instead of its default Sheet.

`OptionSelect` is the shared single-choice UI control used by Framework surfaces. It accepts readonly option
lists, a bound value, and an optional change callback; it has no app or session dependency.

`PageEditor` edits canonical `PageDefinition.layout` directly. Supply a Block catalog,
`onSave(page)`, and a `renderBlock(node)` snippet. The host owns querying, renderer imports,
and navigation. Optional `getConfig`, `getInputs`, and `getOptions` callbacks customize
catalog-driven configuration without putting application state into Framework.
`onFinish()` lets the host remove an edit-mode URL or change its shell.
The editor displays actual content beside an inline inspector, not a separate editing page.
Previews are inert while editing, so selecting a Form/Workflow does not execute it. New Blocks
are staged locally until **Apply changes** succeeds; rearrangements and layout settings save
immediately. Names/descriptions are editable without changing the Page's key or ID.
Pointer dragging moves nodes within/across nested Groups, with menu alternatives for moving
earlier/later or out of a row. The shared drag helper's horizontal preview is opt-in; other
vertical-list consumers retain their existing behavior.
Groups and Blocks keep their IDs when moved or configured; Groups are layout nodes,
not catalog entries. Saves are awaited, duplicate interactions are disabled while saving,
and failed edits restore the previous layout. Configuration errors keep the settings panel open.
`onUnsavedChange(dirty)` exposes unapplied settings/details to the host's navigation guard;
Framework warns on closing its editor or unloading, while the host owns SPA/embedded navigation.
Optional `getInputValue` and `setInputValue` callbacks adapt UI values to structured Block config
without changing the persisted layout. `getOptions(input, config, definition)` receives the
selected catalog definition, and `getIcon` supplies picker icons without importing host renderers.

`PageContent` recursively renders canonical layout, passing only Block nodes to the
host renderer snippet. It supports arbitrary Group nesting without importing renderer code.
Layouts respond to their available container width, rather than the browser viewport, so the same
Page can render in a wide canvas, editor preview or narrow drawer without forced skinny columns.

`PageList` accepts canonical Page definitions and explicit create/update/delete/reorder
callbacks. The host supplies `pageHref(page)` and may supply `onOpen(page, editing)` for
client-side routing. The default falls back to ordinary browser navigation.
Folder and icon choices are optional presentation conventions in `page.meta`; they are
not Kernel entities or routing rules. Existing metadata is retained when changing these choices.
Hosts choose which Pages to include (for example, excluding an implicit Home page), and can
customize placement and empty-state copy.

```svelte
<PageEditor {page} {blocks} onSave={savePage}>
  {#snippet renderBlock(node)}
    <MyBlock node={node} />
  {/snippet}
</PageEditor>
```

Reusable editors must:

- accept canonical Framework definitions, or explicit authoring working models where
  editing needs more information than the persisted definition, and explicit client or
  mutation callbacks;
- avoid application navigation, session globals, and concrete persistence adapters;
- expose focused controls when a host may reasonably need a different composition;
- provide a complete default experience with no required customization ceremony;
- keep host routing and product policy outside the component.

This keeps the common case as a direct import while allowing a host to replace presentation without
forking the Spec, Kernel, or persistence implementation.

The full Collection, View, Form, Rule, and Page editor surfaces are exported from `authoring`. See
[authoring interfaces](authoring.md) for their injection contracts. Working models are not another
supported persisted Spec version.
