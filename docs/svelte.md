# Svelte UI and Studio

Framework supplies a polished Svelte implementation without making that implementation mandatory.
The portable Spec and Kernel do not depend on Svelte.

## Ownership

| Layer                            | Owns                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `@jthum/framework/svelte/ui/*`   | Framework-owned shadcn-Svelte source and semantic design primitives                         |
| `@jthum/framework/svelte/studio` | Reusable editors, editor controls, and authoring interactions                               |
| Implementing app                 | Routes, product shell, navigation, app screens, product policy, and app-specific components |

An implementing app does not move all of its Svelte code into Framework. A component belongs in
Framework only when it is useful to more than one host and can depend on portable definitions or
public client contracts instead of host globals.

## Default setup

Import the Framework theme after Tailwind and shadcn-Svelte, then place host overrides after it:

```css
@import "tailwindcss";
@import "shadcn-svelte/tailwind.css";
@import "@jthum/framework/svelte/theme.css";

:root {
  --primary: oklch(0.55 0.2 265);
  --radius: 0.75rem;
}
```

The theme uses semantic variables. A host may override light and dark values without forking the
components. Product-specific tokens do not belong in the Framework theme.

## Customization levels

Use the least powerful level that solves the requirement:

1. Override semantic CSS variables for colour, radius, typography, chrome, and surfaces.
2. Pass `class` for host layout concerns supported by a component.
3. Use named snippets and callbacks exposed by an editor for actions or host-owned content.
4. Compose exported editor controls into a different outer layout.
5. Replace the whole Framework component while keeping the same Spec and client contracts.

Framework components import Framework's default UI primitives internally. There is deliberately no
global component-override registry: ordinary Svelte composition is more explicit, tree-shakeable,
and easier to understand. A host that needs a different primitive can compose the lower-level
Studio exports or replace the relevant editor.

```svelte
<script lang="ts">
  import { PageHeader } from "@jthum/framework/svelte/studio";
  import MyAction from "$lib/components/my-action.svelte";
</script>

<PageHeader title="Collections" description="Shape the information this app manages.">
  {#snippet actions()}
    <MyAction />
  {/snippet}
</PageHeader>
```

## Editor contract

Reusable editors must:

- accept canonical Framework definitions and explicit client or mutation callbacks;
- avoid SvelteKit navigation, Builder.run session globals, and concrete persistence adapters;
- expose focused controls when a host may reasonably need a different composition;
- provide a complete default experience with no required customization ceremony;
- keep host routing and product policy outside the component.

This keeps the common case as a direct import while allowing a host to replace presentation without
forking the Spec, Kernel, or persistence implementation.
