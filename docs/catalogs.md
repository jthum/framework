# Catalogs

A Catalog is host-selected discovery metadata for reusable resources. It is not a Kernel entity,
a Spec extension, an installer, or a remote-code loader.

`Catalog<Entry>` combines one or more explicitly installed `CatalogSource<Entry>` values. Entry
identity is the pair `source.key` and `entry.key`, so an app-owned source may use the same local key
as an official source without shadowing it. Listing retains provenance and supports source,
category, tag, search, and pagination filters. Returned values are defensive copies.

The common contract is intentionally inert. Different resource families keep their own entry
shapes and installation operations:

- a Block catalog registers definitions and lazy renderer loaders;
- a Field template creates one or more Field definitions;
- a Page template creates a layout tree referencing installed Block keys;
- a Workspace template may install a complete host-owned document, seed records, and Attachments.

Framework Studio may receive catalog entries from a host, but neither Framework nor Studio decides
which sources are installed or whether an app exposes a library UI. Apps may provide only private
entries, combine them with optional shared packages, or omit catalogs entirely.

Installing a template produces ordinary definitions and instance state. Exports contain that
installed result and do not require the original catalog to remain available. Remote catalogs,
trust policy, signatures, dependency resolution, and installation transactions are separate future
concerns; `Catalog` does not imply any of them.
